/**
 * @eloquentjs/pgsql — PostgreSQL Driver
 *
 * Implements the Resolver interface expected by @eloquentjs/core.
 * All SQL parameter numbering ($1, $2 ...) is handled by a single
 * shared `params` array + index counter — fixes the multi-clause
 * parameter offset bugs in the previous version.
 */

import pg from 'pg'
import {
    setResolver, getResolver, runInTransaction,
    indexName, foreignKeyName, assertOperator,
} from '@eloquentjs/core'

const { Pool } = pg

// Return numeric types as JS numbers (pg returns them as strings by default).
// Scoped to this driver's pools via `types` on the pool config rather than
// pg.types, which is process-global and would affect any other pg user.
const poolTypes = {
    getTypeParser(oid, format) {
        if (oid === pg.types.builtins.INT8) return v => parseInt(v, 10)
        if (oid === pg.types.builtins.NUMERIC) return v => parseFloat(v)
        return pg.types.getTypeParser(oid, format)
    },
}

// ─── Per-connection pool registry ─────────────────────────────────────────────
// Keyed by connectionName so multiple named connections each get their own pool.
// This fixes the bug where calling connect() twice would overwrite _pool.
const _pools = new Map()

function _getPool(connectionName = 'default') {
    const pool = _pools.get(connectionName)
    if (!pool) throw new Error(`[EloquentJS/pgsql] No pool for connection "${connectionName}". Did you call connect()?`)
    return pool
}

// ─── connect() ───────────────────────────────────────────────────────────────
export async function connect(config = {}, connectionName = 'default') {
    const poolConfig = config.url
        ? { connectionString: config.url, ssl: config.ssl ?? false }
        : {
            host: config.host ?? 'localhost',
            port: config.port ?? 5432,
            database: config.database ?? config.db,
            user: config.user ?? config.username,
            password: config.password ?? config.pass,
            max: config.poolSize ?? 10,
            idleTimeoutMillis: config.idleTimeout ?? 30_000,
            connectionTimeoutMillis: config.connectTimeout ?? 2_000,
            ssl: config.ssl ?? false,
        }
    poolConfig.types = poolTypes

    // Close existing pool for this name before replacing it
    if (_pools.has(connectionName)) {
        await _pools.get(connectionName).end().catch(() => { })
    }

    const pool = new Pool(poolConfig)

    // Verify connectivity with a quick probe
    const client = await pool.connect()
    try {
        await client.query('SELECT 1')
    } finally {
        client.release()
    }

    _pools.set(connectionName, pool)

    const resolver = new PgResolver(pool, connectionName)
    setResolver(resolver, connectionName)
    return resolver
}

/** Returns the pg.Pool for the named connection (for advanced use). */
export function getPool(connectionName = 'default') {
    return _getPool(connectionName)
}

/** Disconnect and remove the named connection (or all if name omitted). */
export async function disconnect(connectionName) {
    if (connectionName) {
        await _pools.get(connectionName)?.end().catch(() => { })
        _pools.delete(connectionName)
    } else {
        // Disconnect all
        await Promise.all([..._pools.values()].map(p => p.end().catch(() => { })))
        _pools.clear()
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Execute raw SQL on the named connection. */
export async function raw(sql, params = [], connectionName = 'default') {
    const result = await _getPool(connectionName).query(sql, params)
    return result.rows
}

/**
 * Run a function inside a BEGIN/COMMIT transaction. Rolls back on throw.
 * Delegates to the resolver so model writes inside the callback participate —
 * see PgResolver.transaction().
 */
export async function transaction(callback, connectionName = 'default') {
    return getResolver(connectionName).transaction(callback)
}

// ─── PgResolver ──────────────────────────────────────────────────────────────
export class PgResolver {
    /**
     * @param {import('pg').Pool | import('pg').PoolClient} pool
     * @param {string} connectionName
     */
    constructor(pool, connectionName = 'default') {
        this.pool = pool
        this.connectionName = connectionName
        /** Savepoint depth — 0 on a pool-backed resolver. */
        this._txDepth = 0
    }

    // -- TRANSACTIONS ------------------------------------------------
    /**
     * Check out a dedicated client, BEGIN on it, and publish a resolver bound
     * to that client for the duration of the callback (see runInTransaction).
     * Nested calls issue SAVEPOINTs on the same client.
     * @template T
     * @param {(tx: PgResolver) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(fn) {
        // Already inside one on this client → savepoint.
        if (this._txDepth > 0) return this._savepoint(fn)

        const client = await this.pool.connect()
        const scoped = new PgResolver(client, this.connectionName)
        scoped._txDepth = 1
        try {
            await client.query('BEGIN')
            const result = await runInTransaction(this.connectionName, scoped, () => fn(scoped))
            await client.query('COMMIT')
            return result
        } catch (err) {
            await client.query('ROLLBACK').catch(() => { })
            throw err
        } finally {
            client.release()
        }
    }

    async _savepoint(fn) {
        const name = `eloquent_sp_${this._txDepth}`
        const scoped = new PgResolver(this.pool, this.connectionName)
        scoped._txDepth = this._txDepth + 1
        await this.pool.query(`SAVEPOINT ${name}`)
        try {
            const result = await runInTransaction(this.connectionName, scoped, () => fn(scoped))
            await this.pool.query(`RELEASE SAVEPOINT ${name}`)
            return result
        } catch (err) {
            await this.pool.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => { })
            throw err
        }
    }

    // -- RAW ---------------------------------------------------------
    async raw(sql, params = []) {
        const result = await this.pool.query(sql, params)
        return result.rows   // returns just the rows array, matching the standalone raw() helper
    }

    // ── SELECT ──────────────────────────────────────────────────────────────────
    async select(table, ctx) {
        const { sql, params } = buildSelect(table, ctx)
        const result = await this.pool.query(sql, params)
        return result.rows
    }

    // ── INSERT ──────────────────────────────────────────────────────────────────
    async insert(table, data) {
        if (!data || typeof data !== 'object') throw new Error('insert() requires a data object')
        const entries = Object.entries(data).filter(([, v]) => v !== undefined)
        if (!entries.length) throw new Error(`insert() called with empty data on table "${table}"`)

        const params = []
        const cols = entries.map(([k]) => quoteIdent(k)).join(', ')
        const vals = entries.map(([, v]) => { params.push(v); return `$${params.length}` }).join(', ')

        const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals}) RETURNING *`
        const result = await this.pool.query(sql, params)
        return result.rows[0]
    }

    /**
     * Multi-row INSERT. Columns are the union of all row keys; rows missing a
     * key get NULL, so callers may pass heterogeneous objects.
     */
    async insertMany(table, rows) {
        if (!Array.isArray(rows) || !rows.length) return []
        const cols = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => r[k] !== undefined)))]
        if (!cols.length) throw new Error(`insertMany() called with empty rows on table "${table}"`)

        const params = []
        const tuples = rows.map(r =>
            `(${cols.map(c => { params.push(r[c] ?? null); return `$${params.length}` }).join(', ')})`
        )

        const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) `
            + `VALUES ${tuples.join(', ')} RETURNING *`
        const result = await this.pool.query(sql, params)
        return result.rows
    }

    // ── UPSERT ───────────────────────────────────────────────────────────────────
    /**
     * @param {string} table
     * @param {object[]} rows
     * @param {string|string[]} uniqueBy - conflict key column(s), must be covered by a UNIQUE/PRIMARY constraint
     * @param {string[]|null} update - columns to overwrite on conflict; null = all non-key columns
     */
    async upsert(table, rows, uniqueBy, update = null) {
        const list = [rows].flat()
        if (!list.length) return 0
        const keys = [uniqueBy].flat()

        const cols = [...new Set(list.flatMap(r => Object.keys(r).filter(k => r[k] !== undefined)))]
        const updateCols = (update ?? cols.filter(c => !keys.includes(c)))

        const params = []
        const tuples = list.map(r =>
            `(${cols.map(c => { params.push(r[c] ?? null); return `$${params.length}` }).join(', ')})`
        )

        const conflictCols = keys.map(quoteIdent).join(', ')
        let sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')} `
            + `ON CONFLICT (${conflictCols}) DO `

        if (updateCols.length) {
            const sets = updateCols.map(c => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ')
            sql += `UPDATE SET ${sets}`
        } else {
            sql += 'NOTHING'
        }

        const result = await this.pool.query(sql, params)
        return result.rowCount
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────────
    /**
     * @param {string}  table
     * @param {object|null} conditions  - simple key=value conditions (for single-record save)
     * @param {object}  data            - column -> value to SET
     * @param {object}  ctx             - QueryBuilder context (for bulk updates)
     */
    async update(table, conditions, data, ctx = null) {
        const entries = Object.entries(data).filter(([, v]) => v !== undefined)
        if (!entries.length) return 0

        const params = []
        const sets = entries.map(([k, v]) => {
            params.push(v)
            return `${quoteIdent(k)} = $${params.length}`
        })

        let sql = `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')}`

        if (ctx) {
            const { clause, whereParams } = buildWhereClauses(ctx, params.length)
            if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }
        } else if (conditions && Object.keys(conditions).length) {
            const condEntries = Object.entries(conditions)
            const condClauses = condEntries.map(([k, v]) => {
                params.push(v)
                return `${quoteIdent(k)} = $${params.length}`
            })
            sql += ` WHERE ${condClauses.join(' AND ')}`
        }

        const result = await this.pool.query(sql, params)
        return result.rowCount
    }

    // ── DELETE ──────────────────────────────────────────────────────────────────
    async delete(table, conditions, ctx = null) {
        const params = []
        let sql = `DELETE FROM ${quoteIdent(table)}`

        if (ctx) {
            const { clause, whereParams } = buildWhereClauses(ctx, 0)
            if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }
        } else if (conditions && Object.keys(conditions).length) {
            const condEntries = Object.entries(conditions)
            const condClauses = condEntries.map(([k, v]) => {
                params.push(v)
                return `${quoteIdent(k)} = $${params.length}`
            })
            sql += ` WHERE ${condClauses.join(' AND ')}`
        }

        const result = await this.pool.query(sql, params)
        return result.rowCount
    }

    // ── AGGREGATE ───────────────────────────────────────────────────────────────
    async aggregate(table, fn, column, ctx) {
        const col = column === '*' ? '*' : quoteIdent(column)
        const expr = `${fn.toUpperCase()}(${col})`
        // Build a SELECT with just the aggregate, no ORDER BY, no LIMIT/OFFSET
        const aggCtx = {
            ...ctx,
            selects: [{ raw: `${expr} AS _agg` }],
            orderBys: [],
            groupBys: ctx?.groupBys ?? [],
            limit: null,
            offset: null,
            lock: null,
        }

        let sql, params
        if (aggCtx.groupBys.length) {
            // A grouped aggregate returns one row per group; reading rows[0]
            // would report the first group's value. Count/aggregate the groups.
            const inner = buildSelect(table, {
                ...aggCtx,
                selects: fn === 'count'
                    ? aggCtx.groupBys.map(c => ({ raw: quoteIdent(c) }))
                    : [...aggCtx.groupBys.map(c => ({ raw: quoteIdent(c) })), { raw: `${expr} AS _g` }],
            })
            const outer = fn === 'count' ? 'COUNT(*)' : `${fn.toUpperCase()}(_g)`
            sql = `SELECT ${outer} AS _agg FROM (${inner.sql}) AS _grouped`
            params = inner.params
        } else {
            ({ sql, params } = buildSelect(table, aggCtx))
        }
        const result = await this.pool.query(sql, params)
        const raw = result.rows[0]?._agg
        return raw == null ? (fn === 'count' ? 0 : null) : Number(raw)
    }

    // ── INCREMENT ───────────────────────────────────────────────────────────────
    async increment(table, column, amount, extra, ctx) {
        const params = [amount]
        const extraSets = Object.entries(extra ?? {}).map(([k, v]) => {
            params.push(v)
            return `${quoteIdent(k)} = $${params.length}`
        })

        let sql = `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ${quoteIdent(column)} + $1`
        if (extraSets.length) sql += `, ${extraSets.join(', ')}`

        const { clause, whereParams } = buildWhereClauses(ctx, params.length)
        if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }

        const result = await this.pool.query(sql, params)
        return result.rowCount
    }

    // ── PIVOT (BelongsToMany) ───────────────────────────────────────────────────
    async selectPivot({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignId, pivotColumns }) {
        const pivotColsSQL = pivotColumns.map(c => `p.${quoteIdent(c)} AS ${quoteIdent(`_pivot_${c}`)}`).join(', ')
        const extra = pivotColsSQL ? `, ${pivotColsSQL}` : ''

        const sql = `
      SELECT m.*, p.${quoteIdent(pivotForeignKey)} AS _pivot_foreign_id ${extra}
      FROM ${quoteIdent(mainTable)} m
      INNER JOIN ${quoteIdent(pivotTable)} p
        ON p.${quoteIdent(pivotRelatedKey)} = m.${quoteIdent(mainKey)}
      WHERE p.${quoteIdent(pivotForeignKey)} = $1
    `
        const result = await this.pool.query(sql, [foreignId])
        return result.rows.map(row => extractPivot(row, pivotColumns))
    }

    async selectPivotMany({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignIds, pivotColumns }) {
        if (!foreignIds.length) return []

        const pivotColsSQL = pivotColumns.map(c => `p.${quoteIdent(c)} AS ${quoteIdent(`_pivot_${c}`)}`).join(', ')
        const extra = pivotColsSQL ? `, ${pivotColsSQL}` : ''
        const placeholders = foreignIds.map((_, i) => `$${i + 1}`).join(', ')

        const sql = `
      SELECT m.*, p.${quoteIdent(pivotForeignKey)} AS _pivot_foreign_id ${extra}
      FROM ${quoteIdent(mainTable)} m
      INNER JOIN ${quoteIdent(pivotTable)} p
        ON p.${quoteIdent(pivotRelatedKey)} = m.${quoteIdent(mainKey)}
      WHERE p.${quoteIdent(pivotForeignKey)} IN (${placeholders})
    `
        const result = await this.pool.query(sql, foreignIds)
        return result.rows.map(row => extractPivot(row, pivotColumns))
    }

    // ── HAS MANY THROUGH ────────────────────────────────────────────────────────
    async hasManyThrough({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentId }) {
        const sql = `
      SELECT r.*
      FROM ${quoteIdent(relatedTable)} r
      INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}
      WHERE t.${quoteIdent(firstKey)} = $1
    `
        const result = await this.pool.query(sql, [parentId])
        return result.rows
    }

    async hasManyThroughMany({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentIds }) {
        if (!parentIds.length) return []
        const placeholders = parentIds.map((_, i) => `$${i + 1}`).join(', ')
        const sql = `
      SELECT r.*, t.${quoteIdent(firstKey)} AS _parent_id
      FROM ${quoteIdent(relatedTable)} r
      INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}
      WHERE t.${quoteIdent(firstKey)} IN (${placeholders})
    `
        const result = await this.pool.query(sql, parentIds)
        return result.rows
    }

    // ── DDL ─────────────────────────────────────────────────────────────────────
    async createTable(table, blueprint) {
        const colDefs = blueprint.columns.map(col => colToSQL(col))

        // Inline PRIMARY KEY constraints from indexes
        const inlinePks = blueprint.indexes
            .filter(i => i.type === 'primary')
            .map(i => `PRIMARY KEY (${i.columns.map(quoteIdent).join(', ')})`)

        const allDefs = [...colDefs, ...inlinePks].join(',\n  ')
        await this.pool.query(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${allDefs}\n)`)

        // Stand-alone indexes
        await this._applyIndexes(table, blueprint.indexes.filter(i => i.type !== 'primary'))

        // Foreign key constraints
        await this._applyForeigns(table, blueprint.foreigns)
    }

    async alterTable(table, blueprint) {
        for (const col of blueprint.columns) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${colToSQL(col)}`)
        }
        for (const col of blueprint.changes ?? []) {
            const type = colTypeSQL(col)
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(col.name)} TYPE ${type}`)
            await this.pool.query(
                `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(col.name)} ` +
                (col._nullable ? 'DROP NOT NULL' : 'SET NOT NULL')
            )
            if (col._default !== undefined) {
                await this.pool.query(
                    `ALTER TABLE ${quoteIdent(table)} ALTER COLUMN ${quoteIdent(col.name)} ` +
                    (col._default === null ? 'DROP DEFAULT' : `SET DEFAULT ${formatDefault(col._default)}`)
                )
            }
        }
        for (const col of blueprint.drops) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN IF EXISTS ${quoteIdent(col)}`)
        }
        for (const { from, to } of blueprint.renames) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(from)} TO ${quoteIdent(to)}`)
        }
        // #30: indexes and foreign keys used to be silently dropped on Postgres.
        await this._applyIndexes(table, blueprint.indexes ?? [])
        await this._applyForeigns(table, blueprint.foreigns ?? [])
    }

    async _applyIndexes(table, indexes) {
        for (const idx of indexes) {
            if (idx.drop) {
                await this.pool.query(`DROP INDEX IF EXISTS ${quoteIdent(idx.name ?? indexName(table, idx))}`)
                continue
            }
            if (idx.type === 'primary') {
                await this.pool.query(
                    `ALTER TABLE ${quoteIdent(table)} ADD PRIMARY KEY (${idx.columns.map(quoteIdent).join(', ')})`
                )
                continue
            }
            const name = idx.name ?? indexName(table, idx)
            const cols = idx.columns.map(quoteIdent).join(', ')
            const unique = idx.type === 'unique' ? 'UNIQUE ' : ''
            await this.pool.query(
                `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})`
            )
        }
    }

    async _applyForeigns(table, foreigns) {
        for (const fk of foreigns ?? []) {
            const constraintName = fk.name ?? foreignKeyName(table, fk.column)
            if (fk.drop) {
                await this.pool.query(
                    `ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(constraintName)}`
                )
                continue
            }
            const onDel = (fk.onDelete ?? 'RESTRICT').toUpperCase()
            const onUpd = (fk.onUpdate ?? 'CASCADE').toUpperCase()
            await this.pool.query([
                `ALTER TABLE ${quoteIdent(table)}`,
                `ADD CONSTRAINT ${quoteIdent(constraintName)}`,
                `FOREIGN KEY (${quoteIdent(fk.column)})`,
                `REFERENCES ${quoteIdent(fk.table)} (${quoteIdent(fk.references ?? 'id')})`,
                `ON DELETE ${onDel} ON UPDATE ${onUpd}`,
            ].join(' '))
        }
    }

    /**
     * `cascade: true` is opt-in — Laravel never cascades implicitly, and the
     * old unconditional CASCADE silently dropped dependent tables/views.
     */
    async dropTable(table, { ifExists = false, cascade = false } = {}) {
        const guard = ifExists ? 'IF EXISTS ' : ''
        await this.pool.query(`DROP TABLE ${guard}${quoteIdent(table)}${cascade ? ' CASCADE' : ''}`)
    }

    async renameTable(from, to) {
        await this.pool.query(`ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`)
    }

    async truncate(table, { cascade = false, restartIdentity = false } = {}) {
        await this.pool.query(
            `TRUNCATE TABLE ${quoteIdent(table)}`
            + (restartIdentity ? ' RESTART IDENTITY' : '')
            + (cascade ? ' CASCADE' : '')
        )
    }

    async hasTable(table) {
        const r = await this.pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`,
            [table]
        )
        return r.rows[0].exists
    }

    async hasColumn(table, column) {
        const r = await this.pool.query(
            `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)`,
            [table, column]
        )
        return r.rows[0].exists
    }

    async getColumnListing(table) {
        const r = await this.pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
            [table]
        )
        return r.rows.map(row => row.column_name)
    }

    async toSQL(table, ctx) {
        return buildSelect(table, ctx)
    }
}

// ─── SQL Builder ─────────────────────────────────────────────────────────────

/**
 * Quote a PostgreSQL identifier (table or column name).
 * Handles "table.column" notation by quoting each part separately.
 */
function quoteIdent(name) {
    if (!name || name === '*') return name
    // Handle already-quoted identifiers
    if (name.startsWith('"') && name.endsWith('"')) return name
    // Handle "table.column" — quote each part. `table.*` must stay a star;
    // "table"."*" is a syntax error.
    if (name.includes('.')) {
        return name.split('.').map(p => (p === '*' ? '*' : `"${p.replace(/"/g, '""')}"`)).join('.')
    }
    return `"${name.replace(/"/g, '""')}"`
}

/**
 * Build a complete SELECT statement from a QueryBuilder context.
 * Uses a single shared params array so all parameter numbers ($N)
 * are globally unique within the statement.
 */
function buildSelect(table, ctx, startOffset = 0) {
    const params = []
    const ph = () => `$${startOffset + params.length}`

    // ── SELECT clause ────────────────────────────────────────────────────────
    const selects = (ctx.selects ?? ['*']).map(s => {
        if (typeof s === 'object' && s.raw) return s.raw
        if (s === '*') return '*'
        return quoteIdent(s)
    }).join(', ')

    let sql = `SELECT${ctx.distinct ? ' DISTINCT' : ''} ${selects} FROM ${quoteIdent(table)}`

    // ── JOINs ────────────────────────────────────────────────────────────────
    for (const j of ctx.joins ?? []) {
        if (j.type === 'CROSS') {
            sql += ` CROSS JOIN ${quoteIdent(j.table)}`
        } else {
            // Quote first and second as dotted identifiers (e.g. "users"."id")
            sql += ` ${j.type} JOIN ${quoteIdent(j.table)} ON ${quoteIdent(j.first)} ${assertOperator(j.operator ?? '=')} ${quoteIdent(j.second)}`
        }
    }

    // ── WHERE ────────────────────────────────────────────────────────────────
    const { clause: whereClause, whereParams } = buildWhereClauses(ctx, startOffset)
    if (whereClause) {
        sql += ` WHERE ${whereClause}`
        params.push(...whereParams)
    }

    // ── GROUP BY ─────────────────────────────────────────────────────────────
    if (ctx.groupBys?.length) {
        sql += ` GROUP BY ${ctx.groupBys.map(g => (g?.raw ? g.raw : quoteIdent(g))).join(', ')}`
    }

    // ── HAVING — one clause, conditions AND-ed ───────────────────────────────
    const havingParts = (ctx.havings ?? []).map(h => {
        if (h.raw) return h.raw
        params.push(h.value)
        return `${h.aggregate ? `${h.aggregate.toUpperCase()}(${h.column === '*' ? '*' : quoteIdent(h.column)})` : quoteIdent(h.column)} ${assertOperator(h.operator)} ${ph()}`
    })
    if (havingParts.length) sql += ` HAVING ${havingParts.join(' AND ')}`

    // A branch's own ORDER BY/LIMIT is meaningless inside a compound SELECT, so
    // union branches are rendered without them. startOffset carries forward so
    // $N numbering stays globally unique across the whole statement.
    for (const u of ctx.unions ?? []) {
        const branch = buildSelect(
            u.table,
            { ...u.ctx, unions: [], orderBys: [], limit: null, offset: null },
            startOffset + params.length
        )
        sql += ` UNION ${u.all ? 'ALL ' : ''}${branch.sql}`
        params.push(...branch.params)
    }

    // ── ORDER BY — all clauses in ONE ORDER BY, comma-separated ──────────────
    const orderParts = (ctx.orderBys ?? []).map(o => {
        if (o.raw) return o.raw
        if (o.random) return 'RANDOM()'
        return `${quoteIdent(o.column)} ${o.direction}`
    })
    if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`

    // ── LIMIT / OFFSET ───────────────────────────────────────────────────────
    if (ctx.limit != null) { params.push(ctx.limit); sql += ` LIMIT ${ph()}` }
    if (ctx.offset != null) { params.push(ctx.offset); sql += ` OFFSET ${ph()}` }

    // ── LOCKING ──────────────────────────────────────────────────────────────
    if (ctx.lock === 'update') sql += ' FOR UPDATE'
    else if (ctx.lock === 'shared') sql += ' FOR SHARE'

    return { sql, params }
}

/**
 * Build the WHERE clause portion and return the clause string + params.
 * startOffset: number of params already in the outer params array
 * (so our $N numbers continue from there).
 */
function buildWhereClauses(ctx, startOffset) {
    const whereParams = []
    const parts = []

    const push = (v) => {
        whereParams.push(v)
        return `$${startOffset + whereParams.length}`
    }

    for (const w of ctx.wheres ?? []) {
        const bool = w.boolean === 'or' ? 'OR' : 'AND'
        let clause

        switch (w.type) {
            case 'in':
                clause = w.values?.length
                    ? `${quoteIdent(w.column)} IN (${w.values.map(v => push(v)).join(', ')})`
                    : '1=0'
                break
            case 'notIn':
                clause = w.values?.length
                    ? `${quoteIdent(w.column)} NOT IN (${w.values.map(v => push(v)).join(', ')})`
                    : '1=1'
                break
            case 'null':
                clause = `${quoteIdent(w.column)} IS NULL`
                break
            case 'notNull':
                clause = `${quoteIdent(w.column)} IS NOT NULL`
                break
            case 'between':
                clause = `${quoteIdent(w.column)} BETWEEN ${push(w.min)} AND ${push(w.max)}`
                break
            case 'notBetween':
                clause = `${quoteIdent(w.column)} NOT BETWEEN ${push(w.min)} AND ${push(w.max)}`
                break
            case 'date':
                clause = `${quoteIdent(w.column)}::date ${assertOperator(w.operator ?? '=')} ${push(w.value)}`
                break
            case 'time':
                clause = `${quoteIdent(w.column)}::time ${assertOperator(w.operator ?? '=')} ${push(w.value)}`
                break
            case 'column':
                clause = `${quoteIdent(w.first)} ${assertOperator(w.operator ?? '=')} ${quoteIdent(w.second)}`
                break
            case 'exists':
            case 'notExists': {
                const sub = buildSelect(w.table, w.ctx, startOffset + whereParams.length)
                whereParams.push(...sub.params)
                clause = `${w.type === 'notExists' ? 'NOT ' : ''}EXISTS (${sub.sql})`
                break
            }
            case 'year':
                clause = `EXTRACT(YEAR FROM ${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'month':
                clause = `EXTRACT(MONTH FROM ${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'day':
                clause = `EXTRACT(DAY FROM ${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'jsonContains':
                clause = `${quoteIdent(w.column)} @> ${push(JSON.stringify(w.value))}::jsonb`
                break
            case 'group':
            case 'not': {
                const sub = buildWhereClauses(
                    { wheres: w.wheres, rawWheres: w.rawWheres },
                    startOffset + whereParams.length
                )
                if (!sub.clause) continue
                whereParams.push(...sub.whereParams)
                clause = w.type === 'not' ? `NOT (${sub.clause})` : `(${sub.clause})`
                break
            }
            default:
                clause = `${quoteIdent(w.column)} ${assertOperator(w.operator)} ${push(w.value)}`
        }

        parts.push({ bool, clause })
    }

    // Raw WHERE fragments
    for (const rw of ctx.rawWheres ?? []) {
        let sql = rw.sql
        for (const b of rw.bindings) {
            whereParams.push(b)
            sql = sql.replace('?', `$${startOffset + whereParams.length}`)
        }
        parts.push({ bool: 'AND', clause: sql })
    }

    if (!parts.length) return { clause: '', whereParams }

    let clause = parts[0].clause
    for (let i = 1; i < parts.length; i++) {
        clause += ` ${parts[i].bool} ${parts[i].clause}`
    }

    return { clause, whereParams }
}

// ─── DDL Helpers ─────────────────────────────────────────────────────────────
const PG_TYPE_MAP = {
    bigIncrements: 'BIGSERIAL',
    increments: 'SERIAL',
    bigInteger: 'BIGINT',
    integer: 'INTEGER',
    smallInteger: 'SMALLINT',
    tinyInteger: 'SMALLINT',
    float: 'REAL',
    double: 'DOUBLE PRECISION',
    string: null,   // handled below (needs length)
    char: null,
    text: 'TEXT',
    tinyText: 'TEXT',
    mediumText: 'TEXT',
    longText: 'TEXT',
    boolean: 'BOOLEAN',
    date: 'DATE',
    time: 'TIME',
    dateTime: 'TIMESTAMP',
    timestamp: 'TIMESTAMP',
    timestampTz: 'TIMESTAMPTZ',
    year: 'SMALLINT',
    json: 'JSON',
    jsonb: 'JSONB',
    uuid: 'UUID',
    binary: 'BYTEA',
    decimal: null,   // handled below
    enum: null,   // handled below
}

function colTypeSQL(col) {
    let sqlType

    switch (col.type) {
        case 'string': sqlType = `VARCHAR(${col.length ?? 255})`; break
        case 'char': sqlType = `CHAR(${col.length ?? 1})`; break
        case 'decimal': sqlType = `DECIMAL(${col.precision ?? 8}, ${col.scale ?? 2})`; break
        case 'enum': sqlType = `VARCHAR(255) CHECK (${quoteIdent(col.name)} IN (${(col.enumValues ?? []).map(v => `'${v.replace(/'/g, "''")}'`).join(', ')}))`; break
        default:
            sqlType = PG_TYPE_MAP[col.type] ?? col.type.toUpperCase()
    }

    if (col._unsigned && col.type === 'integer') sqlType = 'INTEGER' // pg has no unsigned
    if (col._unsigned && col.type === 'bigInteger') sqlType = 'BIGINT'

    return sqlType
}

function colToSQL(col) {
    let def = `${quoteIdent(col.name)} ${colTypeSQL(col)}`

    // BIGSERIAL/SERIAL only creates the auto-increment sequence — unlike
    // SQLite's INTEGER PRIMARY KEY AUTOINCREMENT, Postgres still needs an
    // explicit PRIMARY KEY or the column (and every FK referencing it, per
    // `constrained()`) has no actual constraint at all.
    if (col.primaryKey) {
        def += ' PRIMARY KEY'
    }

    const isAutoSerial = ['bigIncrements', 'increments'].includes(col.type)
    if (!col._nullable && !col.primaryKey && !isAutoSerial) def += ' NOT NULL'

    if (col._default !== undefined && col._default !== null) {
        def += ` DEFAULT ${formatDefault(col._default)}`
    }

    if (col._unique) def += ' UNIQUE'

    return def
}

/** Portable default markers emitted by core's Blueprint — see Schema.js. */
const PG_EXPR_MAP = {
    uuid: 'gen_random_uuid()',
    now: 'CURRENT_TIMESTAMP',
    today: 'CURRENT_DATE',
}

/**
 * Render a column default. `{expr: 'uuid'}` markers come from core's Blueprint
 * and are rendered per-driver. Plain strings are quoted literals *unless* they
 * look like SQL — a function call or a bare SQL keyword.
 */
function formatDefault(value) {
    if (value && typeof value === 'object' && typeof value.expr === 'string') {
        const sql = PG_EXPR_MAP[value.expr]
        if (!sql) throw new Error(`[EloquentJS/pgsql] Unknown default expression "${value.expr}"`)
        return sql
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    if (typeof value !== 'string') return String(value)
    if (/^[A-Za-z_][\w.]*\s*\(.*\)$/.test(value)) return value
    if (/^(CURRENT_(TIMESTAMP|DATE|TIME)|NULL|TRUE|FALSE)$/i.test(value)) return value
    return `'${value.replace(/'/g, "''")}'`
}

// ─── Pivot helpers ────────────────────────────────────────────────────────────
function extractPivot(row, pivotColumns) {
    const { _pivot_foreign_id, ...rest } = row
    const pivot = {}
    for (const col of pivotColumns) {
        const key = `_pivot_${col}`
        pivot[col] = rest[key]
        delete rest[key]
    }
    return { ...rest, _pivot: pivot, _pivot_foreign_id }
}
