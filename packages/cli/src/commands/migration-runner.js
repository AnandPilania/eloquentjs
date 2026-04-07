/**
 * Migration runner
 *
 * Manages a `_migrations` tracking table in the database.
 * Each migration file is run once and recorded with a batch number.
 * Rollbacks remove the last batch.
 *
 * NOTE: Advisory locks and raw SQL DDL require PostgreSQL. MongoDB is
 * schemaless — migrations are unsupported and will throw a clear error.
 */

import { resolve, join } from 'path'
import { existsSync } from 'fs'
import { colors, success, info, warn, error, scanMigrations, resolveConfig, loadConnection } from '../utils.js'

// ─── Driver guard ─────────────────────────────────────────────────────────
function assertPgDriver(ctx) {
    const cfg = resolveConfig(ctx)
    const driver = (cfg.connection?.driver ?? 'pgsql').toLowerCase()
    if (driver === 'mongodb' || driver === 'mongo') {
        throw new Error(
            '[EloquentJS] Migrations require a SQL database (PostgreSQL). ' +
            'MongoDB is schemaless — manage collection schemas through your application code. ' +
            'If you intended to connect to PostgreSQL, set driver: "pgsql" in your config.'
        )
    }
}

// ─── Advisory lock helpers (PostgreSQL pg_advisory_lock) ──────────────────
// Lock key: a stable integer derived from the string 'eloquentjs_migrations'
const MIGRATION_LOCK_KEY = 7_625_837_178  // stable int < 2^53 (safe for JS + pg bigint)

async function acquireLock(connection) {
    // pg_try_advisory_lock returns false immediately if lock is taken
    const rows = await connection.raw(`SELECT pg_try_advisory_lock($1) AS acquired`, [MIGRATION_LOCK_KEY])
    const result = rows.rows ?? rows
    return result[0]?.acquired === true
}

async function releaseLock(connection) {
    await connection.raw(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]).catch(() => { })
}

// ─── Ensure migration tracking table exists ───────────────────────────────
async function ensureMigrationsTable(connection) {
    await connection.raw(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      migration  VARCHAR(255) NOT NULL UNIQUE,
      batch      INTEGER      NOT NULL,
      ran_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `)
}

// ─── Get already-run migrations from DB ───────────────────────────────────
async function getRanMigrations(connection) {
    const rows = await connection.raw(`SELECT migration, batch FROM _migrations ORDER BY id ASC`)
    return rows.rows ?? rows  // pg returns rows.rows
}

// ─── Record a migration as run ────────────────────────────────────────────
async function recordMigration(connection, name, batch) {
    await connection.raw(
        `INSERT INTO _migrations (migration, batch) VALUES ($1, $2)`,
        [name, batch]
    )
}

// ─── Remove a migration record ────────────────────────────────────────────
async function removeMigration(connection, name) {
    await connection.raw(`DELETE FROM _migrations WHERE migration = $1`, [name])
}

// ─── Get next batch number ────────────────────────────────────────────────
async function getNextBatch(connection) {
    const rows = await connection.raw(`SELECT COALESCE(MAX(batch), 0) + 1 AS next_batch FROM _migrations`)
    const result = rows.rows ?? rows
    return result[0]?.next_batch ?? 1
}

// ─── Main: run pending migrations ─────────────────────────────────────────
export async function runMigrations(ctx) {
    assertPgDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)
    const allFiles = scanMigrations(migrationsDir)

    if (allFiles.length === 0) {
        warn('No migration files found.')
        return { ran: 0 }
    }

    let connection
    try {
        connection = await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }

    await ensureMigrationsTable(connection)

    // Prevent concurrent migration runs (e.g. two deploy processes at once)
    const locked = await acquireLock(connection).catch(() => false)
    if (!locked) {
        throw new Error('Another migration process is running. Please wait and try again.')
    }

    let ran = 0, batch = 0
    try {
        const ranMigrations = await getRanMigrations(connection)
        const ranNames = new Set(ranMigrations.map(r => r.migration))

        const pending = allFiles.filter(f => !ranNames.has(f.filename))

        if (pending.length === 0) {
            info('Nothing to migrate. All migrations are up to date.')
            return { ran: 0 }
        }

        batch = await getNextBatch(connection)

        for (const mig of pending) {
            try {
                const module = await import(mig.path)
                const MigrationClass = module.default
                const instance = new MigrationClass()
                await instance.up()
                await recordMigration(connection, mig.filename, batch)
                success(`Migrated: ${mig.filename}`)
                ran++
            } catch (err) {
                error(`Failed: ${mig.filename}`)
                throw err
            }
        }
    } finally {
        await releaseLock(connection)
    }

    return { ran, batch }
}

// ─── Rollback last N batches ──────────────────────────────────────────────
export async function rollbackMigrations(ctx, { step = 1 } = {}) {
    assertPgDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)

    let connection
    try {
        connection = await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }

    await ensureMigrationsTable(connection)
    const ranMigrations = await getRanMigrations(connection)

    if (ranMigrations.length === 0) {
        info('Nothing to rollback.')
        return { rolledBack: 0 }
    }

    // Find the batches to roll back
    const maxBatch = Math.max(...ranMigrations.map(r => r.batch))
    const targetBatch = maxBatch - step + 1
    const toRollback = ranMigrations
        .filter(r => r.batch >= targetBatch)
        .reverse() // rollback in reverse order

    let rolledBack = 0

    for (const record of toRollback) {
        const migFile = resolve(migrationsDir, record.migration)
        if (!existsSync(migFile)) {
            warn(`Migration file not found, skipping: ${record.migration}`)
            continue
        }

        try {
            const module = await import(migFile)
            const MigrationClass = module.default
            const instance = new MigrationClass()
            await instance.down()
            await removeMigration(connection, record.migration)
            success(`Rolled back: ${record.migration}`)
            rolledBack++
        } catch (err) {
            error(`Failed to rollback: ${record.migration}`)
            throw err
        }
    }

    return { rolledBack }
}

// ─── Rollback ALL migrations ──────────────────────────────────────────────
export async function resetMigrations(ctx) {
    assertPgDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)

    let connection
    try {
        connection = await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }

    await ensureMigrationsTable(connection)
    const ranMigrations = await getRanMigrations(connection)

    if (ranMigrations.length === 0) {
        info('Nothing to reset.')
        return { rolledBack: 0 }
    }

    const reversed = [...ranMigrations].reverse()
    let rolledBack = 0

    for (const record of reversed) {
        const migFile = resolve(migrationsDir, record.migration)
        if (!existsSync(migFile)) {
            warn(`Migration file not found, skipping: ${record.migration}`)
            continue
        }

        try {
            const module = await import(migFile)
            const MigrationClass = module.default
            const instance = new MigrationClass()
            await instance.down()
            await removeMigration(connection, record.migration)
            success(`Rolled back: ${record.migration}`)
            rolledBack++
        } catch (err) {
            error(`Failed to rollback: ${record.migration}`)
            throw err
        }
    }

    return { rolledBack }
}

// ─── Get migration status ─────────────────────────────────────────────────
export async function getMigrationStatus(ctx) {
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)
    const allFiles = scanMigrations(migrationsDir)

    let connection
    try {
        connection = await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }

    await ensureMigrationsTable(connection)
    const ranMigrations = await getRanMigrations(connection)
    const ranMap = new Map(ranMigrations.map(r => [r.migration, r.batch]))

    return allFiles.map(f => ({
        filename: f.filename,
        name: f.name,
        ran: ranMap.has(f.filename),
        batch: ranMap.get(f.filename) ?? null,
    }))
}

// ─── Drop all tables (wipe) ───────────────────────────────────────────────
export async function dropAllTables(ctx) {
    let connection
    try {
        connection = await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }

    // Get all user tables
    const rows = await connection.raw(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `)
    const tables = (rows.rows ?? rows).map(r => r.tablename)

    if (tables.length === 0) {
        info('No tables to drop.')
        return { dropped: 0 }
    }

    // Disable FK checks, drop all, re-enable
    await connection.raw(`SET session_replication_role = 'replica'`)
    for (const table of tables) {
        await connection.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`)
        success(`Dropped table: ${table}`)
    }
    await connection.raw(`SET session_replication_role = 'DEFAULT'`)

    return { dropped: tables.length }
}
