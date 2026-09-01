/**
 * @eloquentjs/mysql — MySQL Driver
 *
 * Implements the Resolver interface expected by @eloquentjs/core.
 * Mirrors @eloquentjs/pgsql's structure (see packages/core/RESOLVER.md),
 * swapping `$N` parameter numbering for `?` placeholders and PostgreSQL's
 * RETURNING clause for an insertId-based re-select (vanilla MySQL has no
 * RETURNING).
 */

import mysql from 'mysql2/promise'
import {
    setResolver, getResolver, runInTransaction,
    indexName, foreignKeyName, assertOperator,
} from '@eloquentjs/core'

// ─── Per-connection pool registry ─────────────────────────────────────────────
// Keyed by connectionName so multiple named connections each get their own pool.
const _pools = new Map()

function _getPool(connectionName = 'default') {
    const pool = _pools.get(connectionName)
    if (!pool) throw new Error(`[EloquentJS/mysql] No pool for connection "${connectionName}". Did you call connect()?`)
    return pool
}

// ─── connect() ───────────────────────────────────────────────────────────────
export async function connect(config = {}, connectionName = 'default') {
    const poolConfig = config.url
        ? config.url
        : {
            host: config.host ?? 'localhost',
            port: config.port ?? 3306,
            database: config.database ?? config.db,
            user: config.user ?? config.username,
            password: config.password ?? config.pass,
            connectionLimit: config.poolSize ?? 10,
            waitForConnections: true,
            decimalNumbers: true, // return DECIMAL as JS numbers, matching pgsql's numeric parsing
            ssl: config.ssl ?? undefined,
        }

    // Close existing pool for this name before replacing it
    if (_pools.has(connectionName)) {
        await _pools.get(connectionName).end().catch(() => { })
    }

    const pool = typeof poolConfig === 'string'
        ? mysql.createPool(poolConfig)
        : mysql.createPool(poolConfig)

    // Verify connectivity with a quick probe
    const conn = await pool.getConnection()
    try {
        await conn.query('SELECT 1')
    } finally {
        conn.release()
    }

    _pools.set(connectionName, pool)

    const resolver = new MySqlResolver(pool, connectionName)
    setResolver(resolver, connectionName)
    return resolver
}

/** Returns the mysql2 Pool for the named connection (for advanced use). */
export function getPool(connectionName = 'default') {
    return _getPool(connectionName)
}

/** Disconnect and remove the named connection (or all if name omitted). */
export async function disconnect(connectionName) {
    if (connectionName) {
        await _pools.get(connectionName)?.end().catch(() => { })
        _pools.delete(connectionName)
    } else {
        await Promise.all([..._pools.values()].map(p => p.end().catch(() => { })))
        _pools.clear()
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Execute raw SQL on the named connection. */
export async function raw(sql, params = [], connectionName = 'default') {
    const [rows] = await _getPool(connectionName).query(sql, params)
    return rows
}

/**
 * Run a function inside a transaction. Rolls back on throw.
 * Delegates to the resolver so model writes inside the callback participate —
 * see MySqlResolver.transaction().
 */
export async function transaction(callback, connectionName = 'default') {
    return getResolver(connectionName).transaction(callback)
}

// ─── MySqlResolver ─────────────────────────────────────────────────────────────
export class MySqlResolver {
    /**
     * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} pool
     * @param {string} connectionName
     */
    constructor(pool, connectionName = 'default') {
        this.pool = pool
        this.connectionName = connectionName
        /** Savepoint depth — 0 on a pool-backed resolver. */
        this._txDepth = 0
        this.supportsJoins = true
    }

    // -- TRANSACTIONS ------------------------------------------------
    /**
     * Check out a dedicated connection, start a transaction on it, and publish
     * a resolver bound to that connection for the duration of the callback.
     * Nested calls issue SAVEPOINTs on the same connection.
     * @template T
     * @param {(tx: MySqlResolver) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(fn) {
        if (this._txDepth > 0) return this._savepoint(fn)

        // Only the top-level (non-transaction) resolver ever reaches here — a
        // scoped resolver's _txDepth > 0 takes the savepoint branch above — but
        // that split is a runtime fact TS can't see from the Pool|PoolConnection union.
        const conn = await (/** @type {import('mysql2/promise').Pool} */ (this.pool)).getConnection()
        const scoped = new MySqlResolver(conn, this.connectionName)
        scoped._txDepth = 1
        try {
            await conn.beginTransaction()
            const result = await runInTransaction(this.connectionName, scoped, () => fn(scoped))
            await conn.commit()
            return result
        } catch (err) {
            await conn.rollback().catch(() => { })
            throw err
        } finally {
            conn.release()
        }
    }

    async _savepoint(fn) {
        const name = `eloquent_sp_${this._txDepth}`
        const scoped = new MySqlResolver(this.pool, this.connectionName)
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

    // mysql2's `query()` return type is a union of RowDataPacket[] (reads) and
    // ResultSetHeader (writes) — narrow it once here instead of casting at
    // every call site.
    /** @returns {Promise<any[]>} */
    async _rows(sql, params = []) {
        const [rows] = /** @type {[any[], any]} */ (await this.pool.query(sql, params))
        return rows
    }

    /** @returns {Promise<import('mysql2/promise').ResultSetHeader>} */
    async _exec(sql, params = []) {
        const [result] = /** @type {[import('mysql2/promise').ResultSetHeader, any]} */ (await this.pool.query(sql, params))
        return result
    }

    // -- RAW ---------------------------------------------------------
    async raw(sql, params = []) {
        return this._rows(sql, params)
    }

    // ── SELECT ──────────────────────────────────────────────────────────────────
    async select(table, ctx) {
        const { sql, params } = buildSelect(table, ctx)
        return this._rows(sql, params)
    }

    // ── INSERT ──────────────────────────────────────────────────────────────────
    // No RETURNING clause in vanilla MySQL — re-select by insertId. Assumes the
    // table's primary key is named "id", the same convention Blueprint's
    // t.id()/t.bigIncrements() use everywhere else in this project.
    async insert(table, data) {
        if (!data || typeof data !== 'object') throw new Error('insert() requires a data object')
        const entries = Object.entries(data).filter(([, v]) => v !== undefined)
        if (!entries.length) throw new Error(`insert() called with empty data on table "${table}"`)

        const cols = entries.map(([k]) => quoteIdent(k)).join(', ')
        const vals = entries.map(() => '?').join(', ')
        const params = entries.map(([, v]) => v)

        const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals})`
        const result = await this._exec(sql, params)

        if (result.insertId) {
            const rows = await this._rows(`SELECT * FROM ${quoteIdent(table)} WHERE id = ?`, [result.insertId])
            if (rows[0]) return rows[0]
        }
        // No auto-increment pk (composite/uuid key) — best effort, mirror what was inserted.
        return { ...data }
    }

    /**
     * Multi-row INSERT. Columns are the union of all row keys; rows missing a
     * key get NULL. One round trip.
     */
    async insertMany(table, rows) {
        if (!Array.isArray(rows) || !rows.length) return []
        const cols = [...new Set(rows.flatMap(r => Object.keys(r).filter(k => r[k] !== undefined)))]
        if (!cols.length) throw new Error(`insertMany() called with empty rows on table "${table}"`)

        const params = []
        const tuples = rows.map(r =>
            `(${cols.map(c => { params.push(r[c] ?? null); return '?' }).join(', ')})`
        )

        const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')}`
        const result = await this._exec(sql, params)

        // A single multi-row INSERT reserves a contiguous AUTO_INCREMENT block
        // (default innodb_autoinc_lock_mode), so insertId..insertId+n-1 are the
        // ids for this statement's rows, in insertion order.
        if (result.insertId && result.affectedRows === rows.length) {
            const ids = Array.from({ length: rows.length }, (_, i) => result.insertId + i)
            return this._rows(
                `SELECT * FROM ${quoteIdent(table)} WHERE id IN (${ids.map(() => '?').join(', ')}) ORDER BY id`,
                ids
            )
        }
        return rows
    }

    // ── UPSERT ───────────────────────────────────────────────────────────────────
    /**
     * @param {string} table
     * @param {object[]} rows
     * @param {string|string[]} uniqueBy - conflict key column(s), must be a UNIQUE/PRIMARY index
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
            `(${cols.map(c => { params.push(r[c] ?? null); return '?' }).join(', ')})`
        )

        const sets = updateCols.map(c => `${quoteIdent(c)} = VALUES(${quoteIdent(c)})`).join(', ')

        let sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')}`
        if (sets.length) sql += ` ON DUPLICATE KEY UPDATE ${sets}`
        else sql += ` ON DUPLICATE KEY UPDATE ${quoteIdent(cols[0])} = ${quoteIdent(cols[0])}` // no-op update, still requires a clause

        const result = await this._exec(sql, params)
        return result.affectedRows
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────────
    async update(table, conditions, data, ctx = null) {
        const entries = Object.entries(data).filter(([, v]) => v !== undefined)
        if (!entries.length) return 0

        const params = []
        const sets = entries.map(([k, v]) => { params.push(v); return `${quoteIdent(k)} = ?` })

        let sql = `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')}`

        if (ctx) {
            const { clause, whereParams } = buildWhereClauses(ctx)
            if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }
        } else if (conditions && Object.keys(conditions).length) {
            const condClauses = Object.entries(conditions).map(([k, v]) => { params.push(v); return `${quoteIdent(k)} = ?` })
            sql += ` WHERE ${condClauses.join(' AND ')}`
        }

        const result = await this._exec(sql, params)
        return result.affectedRows
    }

    // ── DELETE ──────────────────────────────────────────────────────────────────
    async delete(table, conditions, ctx = null) {
        const params = []
        let sql = `DELETE FROM ${quoteIdent(table)}`

        if (ctx) {
            const { clause, whereParams } = buildWhereClauses(ctx)
            if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }
        } else if (conditions && Object.keys(conditions).length) {
            const condClauses = Object.entries(conditions).map(([k, v]) => { params.push(v); return `${quoteIdent(k)} = ?` })
            sql += ` WHERE ${condClauses.join(' AND ')}`
        }

        const result = await this._exec(sql, params)
        return result.affectedRows
    }

    // ── AGGREGATE ───────────────────────────────────────────────────────────────
    async aggregate(table, fn, column, ctx) {
        const col = column === '*' ? '*' : quoteIdent(column)
        const expr = `${fn.toUpperCase()}(${col})`
        const aggCtx = {
            ...ctx,
            selects: [{ raw: `${expr} AS _agg` }],
            orderBys: [],
            groupBys: ctx?.groupBys ?? [],
            limit: null,
            offset: null,
        }

        let sql, params
        if (aggCtx.groupBys.length) {
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
        const rows = await this._rows(sql, params)
        const value = rows[0]?._agg
        return value == null ? (fn === 'count' ? 0 : null) : Number(value)
    }

    // ── INCREMENT ───────────────────────────────────────────────────────────────
    async increment(table, column, amount, extra, ctx) {
        const params = [amount]
        const extraSets = Object.entries(extra ?? {}).map(([k, v]) => { params.push(v); return `${quoteIdent(k)} = ?` })

        let sql = `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ${quoteIdent(column)} + ?`
        if (extraSets.length) sql += `, ${extraSets.join(', ')}`

        const { clause, whereParams } = buildWhereClauses(ctx)
        if (clause) { sql += ` WHERE ${clause}`; params.push(...whereParams) }

        const result = await this._exec(sql, params)
        return result.affectedRows
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
      WHERE p.${quoteIdent(pivotForeignKey)} = ?
    `
        const rows = await this._rows(sql, [foreignId])
        return rows.map(row => extractPivot(row, pivotColumns))
    }

    async selectPivotMany({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignIds, pivotColumns }) {
        if (!foreignIds.length) return []

        const pivotColsSQL = pivotColumns.map(c => `p.${quoteIdent(c)} AS ${quoteIdent(`_pivot_${c}`)}`).join(', ')
        const extra = pivotColsSQL ? `, ${pivotColsSQL}` : ''
        const placeholders = foreignIds.map(() => '?').join(', ')

        const sql = `
      SELECT m.*, p.${quoteIdent(pivotForeignKey)} AS _pivot_foreign_id ${extra}
      FROM ${quoteIdent(mainTable)} m
      INNER JOIN ${quoteIdent(pivotTable)} p
        ON p.${quoteIdent(pivotRelatedKey)} = m.${quoteIdent(mainKey)}
      WHERE p.${quoteIdent(pivotForeignKey)} IN (${placeholders})
    `
        const rows = await this._rows(sql, foreignIds)
        return rows.map(row => extractPivot(row, pivotColumns))
    }

    // ── HAS MANY THROUGH ────────────────────────────────────────────────────────
    async hasManyThrough({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentId }) {
        const sql = `
      SELECT r.*
      FROM ${quoteIdent(relatedTable)} r
      INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}
      WHERE t.${quoteIdent(firstKey)} = ?
    `
        return this._rows(sql, [parentId])
    }

    async hasManyThroughMany({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentIds }) {
        if (!parentIds.length) return []
        const placeholders = parentIds.map(() => '?').join(', ')
        const sql = `
      SELECT r.*, t.${quoteIdent(firstKey)} AS _parent_id
      FROM ${quoteIdent(relatedTable)} r
      INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}
      WHERE t.${quoteIdent(firstKey)} IN (${placeholders})
    `
        return this._rows(sql, parentIds)
    }

    // ── DDL ─────────────────────────────────────────────────────────────────────
    async createTable(table, blueprint) {
        const colDefs = blueprint.columns.map(col => colToSQL(col))

        const inlinePks = blueprint.indexes
            .filter(i => i.type === 'primary')
            .map(i => `PRIMARY KEY (${i.columns.map(quoteIdent).join(', ')})`)

        const allDefs = [...colDefs, ...inlinePks].join(',\n  ')
        await this.pool.query(
            `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${allDefs}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
        )

        await this._applyIndexes(table, blueprint.indexes.filter(i => i.type !== 'primary'))
        await this._applyForeigns(table, blueprint.foreigns)
    }

    async alterTable(table, blueprint) {
        for (const col of blueprint.columns) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${colToSQL(col)}`)
        }
        for (const col of blueprint.changes ?? []) {
            // MySQL has no bare "ALTER COLUMN TYPE" — MODIFY COLUMN re-states the
            // full definition (type + nullability + default) in one statement.
            let def = `${quoteIdent(col.name)} ${colTypeSQL(col)}`
            def += col._nullable ? ' NULL' : ' NOT NULL'
            if (col._default !== undefined) {
                def += col._default === null ? '' : ` DEFAULT ${formatDefault(col._default)}`
            }
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} MODIFY COLUMN ${def}`)
        }
        for (const col of blueprint.drops) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN IF EXISTS ${quoteIdent(col)}`)
        }
        for (const { from, to } of blueprint.renames) {
            await this.pool.query(`ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(from)} TO ${quoteIdent(to)}`)
        }
        await this._applyIndexes(table, blueprint.indexes ?? [])
        await this._applyForeigns(table, blueprint.foreigns ?? [])
    }

    async _applyIndexes(table, indexes) {
        for (const idx of indexes) {
            if (idx.drop) {
                await this.pool.query(`ALTER TABLE ${quoteIdent(table)} DROP INDEX ${quoteIdent(idx.name ?? indexName(table, idx))}`).catch(() => { })
                continue
            }
            if (idx.type === 'primary') {
                await this.pool.query(`ALTER TABLE ${quoteIdent(table)} ADD PRIMARY KEY (${idx.columns.map(quoteIdent).join(', ')})`)
                continue
            }
            const name = idx.name ?? indexName(table, idx)
            const cols = idx.columns.map(quoteIdent).join(', ')
            const unique = idx.type === 'unique' ? 'UNIQUE ' : ''
            // MySQL has no "CREATE INDEX IF NOT EXISTS"; ignore the duplicate-key error instead.
            await this.pool.query(`CREATE ${unique}INDEX ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})`).catch(err => {
                if (!/Duplicate key name/i.test(err.message)) throw err
            })
        }
    }

    async _applyForeigns(table, foreigns) {
        for (const fk of foreigns ?? []) {
            const constraintName = fk.name ?? foreignKeyName(table, fk.column)
            if (fk.drop) {
                await this.pool.query(`ALTER TABLE ${quoteIdent(table)} DROP FOREIGN KEY ${quoteIdent(constraintName)}`).catch(() => { })
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

    async dropTable(table, { ifExists = false } = {}) {
        const guard = ifExists ? 'IF EXISTS ' : ''
        await this.pool.query(`DROP TABLE ${guard}${quoteIdent(table)}`)
    }

    async renameTable(from, to) {
        await this.pool.query(`ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`)
    }

    // MySQL TRUNCATE has no CASCADE keyword; foreign_key_checks must be toggled
    // manually if the caller wants to truncate a table other tables reference.
    async truncate(table, { cascade = false, restartIdentity = false } = {}) {
        if (cascade) await this.pool.query('SET FOREIGN_KEY_CHECKS = 0')
        try {
            await this.pool.query(`TRUNCATE TABLE ${quoteIdent(table)}`)
        } finally {
            if (cascade) await this.pool.query('SET FOREIGN_KEY_CHECKS = 1')
        }
        // restartIdentity is a no-op: TRUNCATE always resets AUTO_INCREMENT in MySQL.
        void restartIdentity
    }

    async hasTable(table) {
        const rows = await this._rows(
            `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
            [table]
        )
        return rows[0].n > 0
    }

    async hasColumn(table, column) {
        const rows = await this._rows(
            `SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
            [table, column]
        )
        return rows[0].n > 0
    }

    async getColumnListing(table) {
        const rows = await this._rows(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
            [table]
        )
        return rows.map(row => row.column_name ?? row.COLUMN_NAME)
    }

    async toSQL(table, ctx) {
        return buildSelect(table, ctx)
    }
}

// ─── SQL Builder ─────────────────────────────────────────────────────────────

/**
 * Quote a MySQL identifier (table or column name) with backticks.
 * Handles "table.column" notation by quoting each part separately.
 */
function quoteIdent(name) {
    if (!name || name === '*') return name
    if (name.startsWith('`') && name.endsWith('`')) return name
    if (name.includes('.')) {
        return name.split('.').map(p => (p === '*' ? '*' : `\`${p.replace(/`/g, '``')}\``)).join('.')
    }
    return `\`${name.replace(/`/g, '``')}\``
}

/** Build a complete SELECT statement from a QueryBuilder context. */
function buildSelect(table, ctx) {
    const params = []

    const selects = (ctx.selects ?? ['*']).map(s => {
        if (typeof s === 'object' && s.raw) return s.raw
        if (s === '*') return '*'
        return quoteIdent(s)
    }).join(', ')

    let sql = `SELECT${ctx.distinct ? ' DISTINCT' : ''} ${selects} FROM ${quoteIdent(table)}`

    for (const j of ctx.joins ?? []) {
        if (j.type === 'CROSS') {
            sql += ` CROSS JOIN ${quoteIdent(j.table)}`
        } else {
            sql += ` ${j.type} JOIN ${quoteIdent(j.table)} ON ${quoteIdent(j.first)} ${assertOperator(j.operator ?? '=')} ${quoteIdent(j.second)}`
        }
    }

    const { clause: whereClause, whereParams } = buildWhereClauses(ctx)
    if (whereClause) { sql += ` WHERE ${whereClause}`; params.push(...whereParams) }

    if (ctx.groupBys?.length) {
        sql += ` GROUP BY ${ctx.groupBys.map(g => (g?.raw ? g.raw : quoteIdent(g))).join(', ')}`
    }

    const havingParts = (ctx.havings ?? []).map(h => {
        if (h.raw) return h.raw
        params.push(h.value)
        return `${h.aggregate ? `${h.aggregate.toUpperCase()}(${h.column === '*' ? '*' : quoteIdent(h.column)})` : quoteIdent(h.column)} ${assertOperator(h.operator)} ?`
    })
    if (havingParts.length) sql += ` HAVING ${havingParts.join(' AND ')}`

    for (const u of ctx.unions ?? []) {
        const branch = buildSelect(u.table, { ...u.ctx, unions: [], orderBys: [], limit: null, offset: null })
        sql += ` UNION ${u.all ? 'ALL ' : ''}${branch.sql}`
        params.push(...branch.params)
    }

    const orderParts = (ctx.orderBys ?? []).map(o => {
        if (o.raw) return o.raw
        if (o.random) return 'RAND()'
        return `${quoteIdent(o.column)} ${o.direction}`
    })
    if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`

    // MySQL requires a LIMIT to use OFFSET; a huge literal cap keeps `.offset()` alone working.
    if (ctx.limit != null) { params.push(ctx.limit); sql += ' LIMIT ?' }
    else if (ctx.offset != null) { sql += ' LIMIT 18446744073709551615' }
    if (ctx.offset != null) { params.push(ctx.offset); sql += ' OFFSET ?' }

    if (ctx.lock === 'update') sql += ' FOR UPDATE'
    else if (ctx.lock === 'shared') sql += ' FOR SHARE'

    return { sql, params }
}

/** Build the WHERE clause portion and return the clause string + params. */
function buildWhereClauses(ctx) {
    const whereParams = []
    const parts = []
    const push = (v) => { whereParams.push(v); return '?' }

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
                clause = `DATE(${quoteIdent(w.column)}) ${assertOperator(w.operator ?? '=')} ${push(w.value)}`
                break
            case 'time':
                clause = `TIME(${quoteIdent(w.column)}) ${assertOperator(w.operator ?? '=')} ${push(w.value)}`
                break
            case 'column':
                clause = `${quoteIdent(w.first)} ${assertOperator(w.operator ?? '=')} ${quoteIdent(w.second)}`
                break
            case 'exists':
            case 'notExists': {
                const sub = buildSelect(w.table, w.ctx)
                whereParams.push(...sub.params)
                clause = `${w.type === 'notExists' ? 'NOT ' : ''}EXISTS (${sub.sql})`
                break
            }
            case 'year':
                clause = `YEAR(${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'month':
                clause = `MONTH(${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'day':
                clause = `DAY(${quoteIdent(w.column)}) = ${push(w.value)}`
                break
            case 'jsonContains':
                clause = `JSON_CONTAINS(${quoteIdent(w.column)}, ${push(JSON.stringify(w.value))})`
                break
            case 'group':
            case 'not': {
                const sub = buildWhereClauses({ wheres: w.wheres, rawWheres: w.rawWheres })
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

    for (const rw of ctx.rawWheres ?? []) {
        let sql = rw.sql
        for (const b of rw.bindings) { whereParams.push(b) }
        parts.push({ bool: 'AND', clause: sql })
    }

    if (!parts.length) return { clause: '', whereParams }

    let clause = parts[0].clause
    for (let i = 1; i < parts.length; i++) clause += ` ${parts[i].bool} ${parts[i].clause}`

    return { clause, whereParams }
}

// ─── DDL Helpers ─────────────────────────────────────────────────────────────
const MYSQL_TYPE_MAP = {
    bigInteger: 'BIGINT',
    integer: 'INT',
    smallInteger: 'SMALLINT',
    tinyInteger: 'TINYINT',
    float: 'FLOAT',
    double: 'DOUBLE',
    text: 'TEXT',
    tinyText: 'TINYTEXT',
    mediumText: 'MEDIUMTEXT',
    longText: 'LONGTEXT',
    boolean: 'TINYINT(1)',
    date: 'DATE',
    time: 'TIME',
    dateTime: 'DATETIME',
    timestamp: 'TIMESTAMP',
    timestampTz: 'TIMESTAMP', // MySQL TIMESTAMP is stored in UTC internally; no separate tz-aware type
    year: 'YEAR',
    json: 'JSON',
    jsonb: 'JSON', // no native JSONB in MySQL
    uuid: 'CHAR(36)',
    binary: 'BLOB',
}

function colTypeSQL(col) {
    let sqlType

    switch (col.type) {
        case 'bigIncrements': sqlType = 'BIGINT UNSIGNED AUTO_INCREMENT'; break
        case 'increments': sqlType = 'INT UNSIGNED AUTO_INCREMENT'; break
        case 'string': sqlType = `VARCHAR(${col.length ?? 255})`; break
        case 'char': sqlType = `CHAR(${col.length ?? 1})`; break
        case 'decimal': sqlType = `DECIMAL(${col.precision ?? 8}, ${col.scale ?? 2})`; break
        case 'enum': sqlType = `ENUM(${(col.enumValues ?? []).map(v => `'${v.replace(/'/g, "''")}'`).join(', ')})`; break
        default:
            sqlType = MYSQL_TYPE_MAP[col.type] ?? col.type.toUpperCase()
    }

    if (col._unsigned && /^(INT|BIGINT|SMALLINT|TINYINT)$/.test(sqlType)) sqlType += ' UNSIGNED'

    return sqlType
}

function colToSQL(col) {
    let def = `${quoteIdent(col.name)} ${colTypeSQL(col)}`

    const isAutoIncrement = ['bigIncrements', 'increments'].includes(col.type)
    if (!col._nullable && !isAutoIncrement) def += ' NOT NULL'

    if (col._default !== undefined && col._default !== null) {
        def += ` DEFAULT ${formatDefault(col._default)}`
    }

    if (col.primaryKey && isAutoIncrement) def += ' PRIMARY KEY'
    else if (col.primaryKey) def += ' PRIMARY KEY'

    if (col._unique) def += ' UNIQUE'

    return def
}

/** Portable default markers emitted by core's Blueprint — see Schema.js. */
const MYSQL_EXPR_MAP = {
    uuid: 'UUID()',
    now: 'CURRENT_TIMESTAMP',
    today: '(CURRENT_DATE)', // MySQL requires non-constant DATE defaults to be parenthesized
}

function formatDefault(value) {
    if (value && typeof value === 'object' && typeof value.expr === 'string') {
        const sql = MYSQL_EXPR_MAP[value.expr]
        if (!sql) throw new Error(`[EloquentJS/mysql] Unknown default expression "${value.expr}"`)
        return sql
    }
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (typeof value !== 'string') return String(value)
    if (/^[A-Za-z_][\w.]*\s*\(.*\)$/.test(value)) return value
    if (/^(CURRENT_TIMESTAMP|NULL|TRUE|FALSE)$/i.test(value)) return value
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
