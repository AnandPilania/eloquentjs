/**
 * Migration runner
 *
 * Manages a `_migrations` tracking table in the database.
 * Each migration file is run once and recorded with a batch number.
 * Rollbacks remove the last batch.
 *
 * NOTE: MongoDB is schemaless — migrations are unsupported and will throw a
 * clear error. SQL drivers use a common migration table with driver-specific
 * DDL where needed.
 */

import { resolve } from 'path'
import { existsSync } from 'fs'
import { pathToFileURL } from 'node:url'
import { success, info, warn, error, scanMigrations, resolveConfig, loadConnection, normalizeDriver } from '../utils.js'

// ─── Driver guard ─────────────────────────────────────────────────────────
function getDriver(ctx) {
    const cfg = resolveConfig(ctx)
    return normalizeDriver((cfg.connection?.driver ?? 'pgsql').toLowerCase())
}

function isSqlite(ctx) {
    return getDriver(ctx) === 'sqlite'
}

function assertSqlDriver(ctx) {
    const driver = getDriver(ctx)
    if (driver === 'mongodb') {
        throw new Error(
            '[EloquentJS] Migrations require a SQL database (PostgreSQL or SQLite). ' +
            'MongoDB is schemaless — manage collection schemas through your application code. ' +
            'If you intended to connect to SQL, set driver: "pgsql" or "sqlite" in your config.'
        )
    }
}

async function openConnection(ctx) {
    try {
        return await loadConnection(ctx)
    } catch (err) {
        throw new Error(`Cannot connect to database: ${err.message}`)
    }
}

// ─── Advisory lock helpers (PostgreSQL pg_advisory_lock) ──────────────────
// Lock key: a stable integer derived from the string 'eloquentjs_migrations'
const MIGRATION_LOCK_KEY = 7_625_837_178  // stable int < 2^53 (safe for JS + pg bigint)

function quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`
}

async function acquireLock(connection, ctx) {
    if (isSqlite(ctx)) return true
    // pg_try_advisory_lock returns false immediately if lock is taken
    const rows = await connection.raw(`SELECT pg_try_advisory_lock($1) AS acquired`, [MIGRATION_LOCK_KEY])
    const result = rows.rows ?? rows
    return result[0]?.acquired === true
}

async function releaseLock(connection, ctx) {
    if (isSqlite(ctx)) return
    await connection.raw(`SELECT pg_advisory_unlock($1)`, [MIGRATION_LOCK_KEY]).catch(() => { })
}

// ─── Ensure migration tracking table exists ───────────────────────────────
async function ensureMigrationsTable(connection, ctx) {
    if (isSqlite(ctx)) {
        await connection.raw(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      migration  TEXT    NOT NULL UNIQUE,
      batch      INTEGER NOT NULL,
      ran_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
        return
    }

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
    assertSqlDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)
    const allFiles = scanMigrations(migrationsDir)

    if (allFiles.length === 0) {
        warn('No migration files found.')
        return { ran: 0 }
    }

    const connection = await openConnection(ctx)

    await ensureMigrationsTable(connection, ctx)

    // Prevent concurrent migration runs (e.g. two deploy processes at once)
    const locked = await acquireLock(connection, ctx).catch(() => false)
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
                const fileUrl = pathToFileURL(mig.path)
                const module = await import(fileUrl.href)
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
        await releaseLock(connection, ctx)
    }

    return { ran, batch }
}

// ─── Rollback last N batches ──────────────────────────────────────────────
export async function rollbackMigrations(ctx, { step = 1 } = {}) {
    assertSqlDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)

    const connection = await openConnection(ctx)

    await ensureMigrationsTable(connection, ctx)
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
            const module = await import(pathToFileURL(migFile).href)
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
    assertSqlDriver(ctx)
    const cfg = resolveConfig(ctx)
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)

    const connection = await openConnection(ctx)

    await ensureMigrationsTable(connection, ctx)
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
            const module = await import(pathToFileURL(migFile).href)
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

    const connection = await openConnection(ctx)

    await ensureMigrationsTable(connection, ctx)
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
    const connection = await openConnection(ctx)

    const sqlite = isSqlite(ctx)

    // Get all user tables
    const rows = sqlite ? await connection.raw(`
    SELECT name AS tablename FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `) : await connection.raw(`
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
    if (sqlite) await connection.raw(`PRAGMA foreign_keys = OFF`)
    else await connection.raw(`SET session_replication_role = 'replica'`)
    for (const table of tables) {
        const quotedTable = quoteIdent(table)
        await connection.raw(sqlite ? `DROP TABLE IF EXISTS ${quotedTable}` : `DROP TABLE IF EXISTS ${quotedTable} CASCADE`)
        success(`Dropped table: ${table}`)
    }
    if (sqlite) await connection.raw(`PRAGMA foreign_keys = ON`)
    else await connection.raw(`SET session_replication_role = 'DEFAULT'`)

    return { dropped: tables.length }
}
