/**
 * @eloquentjs/pgsql — PostgreSQL Driver
 *
 * Implements the Resolver interface expected by @eloquentjs/core.
 * All SQL parameter numbering ($1, $2 ...) is handled by a single
 * shared `params` array + index counter — fixes the multi-clause
 * parameter offset bugs in the previous version.
 */

import pg from 'pg'
import { setResolver } from '@eloquentjs/core'

const { Pool, types } = pg

// Return numeric types as JS numbers (pg returns them as strings by default)
types.setTypeParser(types.builtins.INT8,    v => parseInt(v, 10))
types.setTypeParser(types.builtins.NUMERIC, v => parseFloat(v))

let _pool = null

// ─── connect() ───────────────────────────────────────────────────────────────
export async function connect(config = {}, connectionName = 'default') {
  const poolConfig = config.url
    ? { connectionString: config.url, ssl: config.ssl ?? false }
    : {
        host:                    config.host     ?? 'localhost',
        port:                    config.port     ?? 5432,
        database:                config.database ?? config.db,
        user:                    config.user     ?? config.username,
        password:                config.password ?? config.pass,
        max:                     config.poolSize ?? 10,
        idleTimeoutMillis:       config.idleTimeout    ?? 30_000,
        connectionTimeoutMillis: config.connectTimeout ?? 2_000,
        ssl:                     config.ssl ?? false,
      }

  _pool = new Pool(poolConfig)

  // Verify connectivity
  const client = await _pool.connect()
  try {
    await client.query('SELECT 1')
  } finally {
    client.release()
  }

  const resolver = new PgResolver(_pool)
  setResolver(resolver, connectionName)
  return resolver
}

export function getPool()       { return _pool }
export async function disconnect() { await _pool?.end(); _pool = null }

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Execute raw SQL outside of a model. */
export async function raw(sql, params = []) {
  const result = await _pool.query(sql, params)
  return result.rows
}

/** Run a function inside a BEGIN/COMMIT transaction. Rolls back on throw. */
export async function transaction(callback) {
  const client = await _pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(new TransactionClient(client))
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── PgResolver ──────────────────────────────────────────────────────────────
export class PgResolver {
  constructor(pool) {
    this.pool = pool
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
    const cols   = entries.map(([k]) => quoteIdent(k)).join(', ')
    const vals   = entries.map(([, v]) => { params.push(v); return `$${params.length}` }).join(', ')

    const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals}) RETURNING *`
    const result = await this.pool.query(sql, params)
    return result.rows[0]
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
    const sets   = entries.map(([k, v]) => {
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
    const col  = column === '*' ? '*' : quoteIdent(column)
    const expr = `${fn.toUpperCase()}(${col})`
    // Build a SELECT with just the aggregate, no ORDER BY, no LIMIT/OFFSET
    const aggCtx = {
      ...ctx,
      selects:  [{ raw: `${expr} AS _agg` }],
      orderBys: [],
      groupBys: ctx?.groupBys ?? [],
      limit:    null,
      offset:   null,
    }
    const { sql, params } = buildSelect(table, aggCtx)
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
    for (const idx of blueprint.indexes.filter(i => i.type !== 'primary')) {
      const name = idx.name ?? `${table}_${idx.columns.join('_')}_${idx.type}`
      const cols = idx.columns.map(quoteIdent).join(', ')
      if (idx.type === 'unique') {
        await this.pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})`)
      } else if (idx.type === 'index') {
        await this.pool.query(`CREATE INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})`)
      }
    }

    // Foreign key constraints
    for (const fk of blueprint.foreigns) {
      if (fk.drop) continue
      const constraintName = `fk_${table}_${fk.column}`
      const onDel = (fk.onDelete ?? 'RESTRICT').toUpperCase()
      const onUpd = (fk.onUpdate ?? 'CASCADE').toUpperCase()
      const sql = [
        `ALTER TABLE ${quoteIdent(table)}`,
        `ADD CONSTRAINT ${quoteIdent(constraintName)}`,
        `FOREIGN KEY (${quoteIdent(fk.column)})`,
        `REFERENCES ${quoteIdent(fk.table)} (${quoteIdent(fk.references ?? 'id')})`,
        `ON DELETE ${onDel} ON UPDATE ${onUpd}`,
      ].join(' ')
      await this.pool.query(sql)
    }
  }

  async alterTable(table, blueprint) {
    for (const col of blueprint.columns) {
      await this.pool.query(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${colToSQL(col)}`)
    }
    for (const col of blueprint.drops) {
      await this.pool.query(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN IF EXISTS ${quoteIdent(col)}`)
    }
    for (const { from, to } of blueprint.renames) {
      await this.pool.query(`ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(from)} TO ${quoteIdent(to)}`)
    }
  }

  async dropTable(table, { ifExists = false } = {}) {
    const guard = ifExists ? 'IF EXISTS ' : ''
    await this.pool.query(`DROP TABLE ${guard}${quoteIdent(table)} CASCADE`)
  }

  async renameTable(from, to) {
    await this.pool.query(`ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`)
  }

  async truncate(table) {
    await this.pool.query(`TRUNCATE TABLE ${quoteIdent(table)} RESTART IDENTITY CASCADE`)
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
  // Handle "table.column" — quote each part
  if (name.includes('.')) {
    return name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.')
  }
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Build a complete SELECT statement from a QueryBuilder context.
 * Uses a single shared params array so all parameter numbers ($N)
 * are globally unique within the statement.
 */
function buildSelect(table, ctx) {
  const params = []

  const push = (v) => { params.push(v); return `$${params.length}` }

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
      sql += ` ${j.type} JOIN ${quoteIdent(j.table)} ON ${quoteIdent(j.first)} ${j.operator} ${quoteIdent(j.second)}`
    }
  }

  // ── WHERE ────────────────────────────────────────────────────────────────
  const { clause: whereClause, whereParams } = buildWhereClauses(ctx, 0)
  if (whereClause) {
    sql += ` WHERE ${whereClause}`
    params.push(...whereParams)
  }

  // ── GROUP BY ─────────────────────────────────────────────────────────────
  if (ctx.groupBys?.length) {
    sql += ` GROUP BY ${ctx.groupBys.map(quoteIdent).join(', ')}`
  }

  // ── HAVING ───────────────────────────────────────────────────────────────
  for (const h of ctx.havings ?? []) {
    params.push(h.value)
    sql += ` HAVING ${quoteIdent(h.column)} ${h.operator} $${params.length}`
  }

  // ── ORDER BY — all clauses in ONE ORDER BY, comma-separated ──────────────
  const orderParts = (ctx.orderBys ?? []).map(o => {
    if (o.raw)    return o.raw
    if (o.random) return 'RANDOM()'
    return `${quoteIdent(o.column)} ${o.direction}`
  })
  if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`

  // ── LIMIT / OFFSET ───────────────────────────────────────────────────────
  if (ctx.limit  != null) { params.push(ctx.limit);  sql += ` LIMIT $${params.length}` }
  if (ctx.offset != null) { params.push(ctx.offset); sql += ` OFFSET $${params.length}` }

  return { sql, params }
}

/**
 * Build the WHERE clause portion and return the clause string + params.
 * startOffset: number of params already in the outer params array
 * (so our $N numbers continue from there).
 */
function buildWhereClauses(ctx, startOffset) {
  const whereParams = []
  const parts       = []

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
        clause = `${quoteIdent(w.column)}::date ${w.operator} ${push(w.value)}`
        break
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
      default:
        clause = `${quoteIdent(w.column)} ${w.operator} ${push(w.value)}`
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
  increments:    'SERIAL',
  bigInteger:    'BIGINT',
  integer:       'INTEGER',
  smallInteger:  'SMALLINT',
  tinyInteger:   'SMALLINT',
  float:         'REAL',
  double:        'DOUBLE PRECISION',
  string:        null,   // handled below (needs length)
  char:          null,
  text:          'TEXT',
  boolean:       'BOOLEAN',
  date:          'DATE',
  time:          'TIME',
  dateTime:      'TIMESTAMP',
  timestamp:     'TIMESTAMP',
  timestampTz:   'TIMESTAMPTZ',
  year:          'SMALLINT',
  json:          'JSON',
  jsonb:         'JSONB',
  uuid:          'UUID',
  binary:        'BYTEA',
  decimal:       null,   // handled below
  enum:          null,   // handled below
}

function colToSQL(col) {
  let sqlType

  switch (col.type) {
    case 'string': sqlType = `VARCHAR(${col.length ?? 255})`; break
    case 'char':   sqlType = `CHAR(${col.length ?? 1})`;      break
    case 'decimal':sqlType = `DECIMAL(${col.precision ?? 8}, ${col.scale ?? 2})`; break
    case 'enum':   sqlType = `VARCHAR(255) CHECK (${quoteIdent(col.name)} IN (${(col.enumValues ?? []).map(v => `'${v.replace(/'/g,"''")}'`).join(', ')}))`; break
    default:
      sqlType = PG_TYPE_MAP[col.type] ?? col.type.toUpperCase()
  }

  if (col.unsigned && col.type === 'integer') sqlType = 'INTEGER' // pg has no unsigned
  if (col.unsigned && col.type === 'bigInteger') sqlType = 'BIGINT'

  let def = `${quoteIdent(col.name)} ${sqlType}`

  if (col.primaryKey && !['bigIncrements','increments'].includes(col.type)) {
    def += ' PRIMARY KEY'
  }

  const isAutoSerial = ['bigIncrements','increments'].includes(col.type)
  if (!col._nullable && !col.primaryKey && !isAutoSerial) def += ' NOT NULL'

  if (col._default !== undefined && col._default !== null) {
    const dv = typeof col._default === 'string' ? col._default : `'${col._default}'`
    def += ` DEFAULT ${dv}`
  }

  if (col._unique) def += ' UNIQUE'

  return def
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

// ─── TransactionClient ────────────────────────────────────────────────────────
class TransactionClient {
  constructor(client) { this._client = client }
  async query(sql, params = []) { return this._client.query(sql, params) }
}
