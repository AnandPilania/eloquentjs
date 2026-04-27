/**
 * @eloquentjs/sqlite — SQLite Driver
 *
 * Implements the resolver interface expected by @eloquentjs/core.
 * Uses Bun's native SQLite in Bun and better-sqlite3 elsewhere. The public API
 * remains async so it matches the PostgreSQL and MongoDB drivers.
 */

import { setResolver } from '@eloquentjs/core'

// ─── Per-connection database registry ────────────────────────────────────────
const _dbs = new Map()

function _getDb(connectionName = 'default') {
  const db = _dbs.get(connectionName)
  if (!db) throw new Error(`[EloquentJS/sqlite] No database for connection "${connectionName}". Did you call connect()?`)
  return db
}

// ─── connect() ───────────────────────────────────────────────────────────────
export async function connect(config = {}, connectionName = 'default') {
  const { Database, runtime } = await loadDatabase()
  const filename = config.filename ?? config.database ?? config.path ?? ':memory:'

  if (_dbs.has(connectionName)) {
    _dbs.get(connectionName).close()
  }

  const db = new Database(filename, databaseOptions(runtime, config.options))
  if (config.foreignKeys !== false) execSql(db, 'PRAGMA foreign_keys = ON')
  if (config.wal) execSql(db, 'PRAGMA journal_mode = WAL')

  _dbs.set(connectionName, db)

  const resolver = new SQLiteResolver(db)
  setResolver(resolver, connectionName)
  return resolver
}

async function loadDatabase() {
  if (globalThis.Bun) {
    const { Database } = await import('bun:sqlite')
    return { Database, runtime: 'bun' }
  }

  const { default: Database } = await import('better-sqlite3')
  return { Database, runtime: 'node' }
}

function databaseOptions(runtime, options = {}) {
  if (runtime !== 'bun') return options
  return { create: true, readwrite: true, ...options }
}

/** Returns the raw SQLite Database for the named connection. */
export function getDb(connectionName = 'default') {
  return _getDb(connectionName)
}

/** Disconnect and remove the named connection (or all if name omitted). */
export async function disconnect(connectionName) {
  if (connectionName) {
    _dbs.get(connectionName)?.close()
    _dbs.delete(connectionName)
  } else {
    for (const db of _dbs.values()) db.close()
    _dbs.clear()
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
/** Execute raw SQL on the named connection. PostgreSQL-style $1 placeholders are accepted. */
export async function raw(sql, params = [], connectionName = 'default') {
  const stmt = _getDb(connectionName).prepare(toSqlitePlaceholders(sql))
  return isReader(stmt, sql) ? stmt.all(...params) : stmt.run(...params)
}

/** Run a function inside a BEGIN/COMMIT transaction. Rolls back on throw. */
export async function transaction(callback, connectionName = 'default') {
  const db = _getDb(connectionName)
  db.prepare('BEGIN').run()

  try {
    const result = await callback(new TransactionClient(db))
    db.prepare('COMMIT').run()
    return result
  } catch (err) {
    db.prepare('ROLLBACK').run()
    throw err
  }
}

// ─── SQLiteResolver ─────────────────────────────────────────────────────────
export class SQLiteResolver {
  constructor(db) {
    this.db = db
  }

  async raw(sql, params = []) {
    const stmt = this.db.prepare(toSqlitePlaceholders(sql))
    return isReader(stmt, sql) ? stmt.all(...params) : stmt.run(...params)
  }

  // ── SELECT ─────────────────────────────────────────────────────────────────
  async select(table, ctx) {
    const { sql, params } = buildSelect(table, ctx)
    return this.db.prepare(sql).all(...params)
  }

  // ── INSERT ─────────────────────────────────────────────────────────────────
  async insert(table, data) {
    if (!data || typeof data !== 'object') throw new Error('insert() requires a data object')

    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    if (!entries.length) throw new Error(`insert() called with empty data on table "${table}"`)

    const cols = entries.map(([k]) => quoteIdent(k)).join(', ')
    const vals = entries.map(() => '?').join(', ')
    const params = entries.map(([, v]) => prepareValue(v))

    const result = this.db.prepare(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${vals})`).run(...params)
    return this.db.prepare(`SELECT * FROM ${quoteIdent(table)} WHERE rowid = ?`).get(result.lastInsertRowid)
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────
  async update(table, conditions, data, ctx = null) {
    const entries = Object.entries(data).filter(([, v]) => v !== undefined)
    if (!entries.length) return 0

    const params = entries.map(([, v]) => prepareValue(v))
    const sets = entries.map(([k]) => `${quoteIdent(k)} = ?`)
    let sql = `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')}`

    if (ctx) {
      const { clause, whereParams } = buildWhereClauses(ctx)
      if (clause) {
        sql += ` WHERE ${clause}`
        params.push(...whereParams)
      }
    } else if (conditions && Object.keys(conditions).length) {
      const condEntries = Object.entries(conditions)
      sql += ` WHERE ${condEntries.map(([k]) => `${quoteIdent(k)} = ?`).join(' AND ')}`
      params.push(...condEntries.map(([, v]) => prepareValue(v)))
    }

    return this.db.prepare(sql).run(...params).changes
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────
  async delete(table, conditions, ctx = null) {
    const params = []
    let sql = `DELETE FROM ${quoteIdent(table)}`

    if (ctx) {
      const { clause, whereParams } = buildWhereClauses(ctx)
      if (clause) {
        sql += ` WHERE ${clause}`
        params.push(...whereParams)
      }
    } else if (conditions && Object.keys(conditions).length) {
      const condEntries = Object.entries(conditions)
      sql += ` WHERE ${condEntries.map(([k]) => `${quoteIdent(k)} = ?`).join(' AND ')}`
      params.push(...condEntries.map(([, v]) => prepareValue(v)))
    }

    return this.db.prepare(sql).run(...params).changes
  }

  // ── AGGREGATE ──────────────────────────────────────────────────────────────
  async aggregate(table, fn, column, ctx) {
    const col = column === '*' ? '*' : quoteIdent(column)
    const aggCtx = {
      ...ctx,
      selects: [{ raw: `${fn.toUpperCase()}(${col}) AS _agg` }],
      orderBys: [],
      limit: null,
      offset: null,
    }

    const { sql, params } = buildSelect(table, aggCtx)
    const raw = this.db.prepare(sql).get(...params)?._agg
    return raw == null ? (fn === 'count' ? 0 : null) : Number(raw)
  }

  // ── INCREMENT ──────────────────────────────────────────────────────────────
  async increment(table, column, amount, extra, ctx) {
    const params = [amount]
    const extraSets = Object.entries(extra ?? {}).map(([k, v]) => {
      params.push(prepareValue(v))
      return `${quoteIdent(k)} = ?`
    })

    let sql = `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ${quoteIdent(column)} + ?`
    if (extraSets.length) sql += `, ${extraSets.join(', ')}`

    const { clause, whereParams } = buildWhereClauses(ctx)
    if (clause) {
      sql += ` WHERE ${clause}`
      params.push(...whereParams)
    }

    return this.db.prepare(sql).run(...params).changes
  }

  // ── PIVOT (BelongsToMany) ──────────────────────────────────────────────────
  async selectPivot({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignId, pivotColumns }) {
    const pivotColsSQL = pivotColumns.map(c => `p.${quoteIdent(c)} AS ${quoteIdent(`_pivot_${c}`)}`).join(', ')
    const extra = pivotColsSQL ? `, ${pivotColsSQL}` : ''
    const sql = [
      `SELECT m.*, p.${quoteIdent(pivotForeignKey)} AS _pivot_foreign_id ${extra}`,
      `FROM ${quoteIdent(mainTable)} m`,
      `INNER JOIN ${quoteIdent(pivotTable)} p ON p.${quoteIdent(pivotRelatedKey)} = m.${quoteIdent(mainKey)}`,
      `WHERE p.${quoteIdent(pivotForeignKey)} = ?`,
    ].join(' ')

    return this.db.prepare(sql).all(foreignId).map(row => extractPivot(row, pivotColumns))
  }

  async selectPivotMany({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignIds, pivotColumns }) {
    if (!foreignIds.length) return []

    const pivotColsSQL = pivotColumns.map(c => `p.${quoteIdent(c)} AS ${quoteIdent(`_pivot_${c}`)}`).join(', ')
    const extra = pivotColsSQL ? `, ${pivotColsSQL}` : ''
    const placeholders = foreignIds.map(() => '?').join(', ')
    const sql = [
      `SELECT m.*, p.${quoteIdent(pivotForeignKey)} AS _pivot_foreign_id ${extra}`,
      `FROM ${quoteIdent(mainTable)} m`,
      `INNER JOIN ${quoteIdent(pivotTable)} p ON p.${quoteIdent(pivotRelatedKey)} = m.${quoteIdent(mainKey)}`,
      `WHERE p.${quoteIdent(pivotForeignKey)} IN (${placeholders})`,
    ].join(' ')

    return this.db.prepare(sql).all(...foreignIds).map(row => extractPivot(row, pivotColumns))
  }

  // ── HAS MANY THROUGH ───────────────────────────────────────────────────────
  async hasManyThrough({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentId }) {
    const sql = [
      'SELECT r.*',
      `FROM ${quoteIdent(relatedTable)} r`,
      `INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}`,
      `WHERE t.${quoteIdent(firstKey)} = ?`,
    ].join(' ')

    return this.db.prepare(sql).all(parentId)
  }

  async hasManyThroughMany({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentIds }) {
    if (!parentIds.length) return []

    const placeholders = parentIds.map(() => '?').join(', ')
    const sql = [
      `SELECT r.*, t.${quoteIdent(firstKey)} AS _parent_id`,
      `FROM ${quoteIdent(relatedTable)} r`,
      `INNER JOIN ${quoteIdent(throughTable)} t ON t.${quoteIdent(throughKey)} = r.${quoteIdent(secondKey)}`,
      `WHERE t.${quoteIdent(firstKey)} IN (${placeholders})`,
    ].join(' ')

    return this.db.prepare(sql).all(...parentIds)
  }

  // ── DDL ────────────────────────────────────────────────────────────────────
  async createTable(table, blueprint) {
    const columns = blueprint.columns.map(col => ({ name: col.name, sql: columnToSQL(col) }))
    const foreignKeys = blueprint.foreigns.filter(fk => !fk.drop)
    const sql = buildCreateTableSQL(table, columns, foreignKeys, blueprint.indexes)

    await this.db.prepare(sql).run()

    for (const idx of blueprint.indexes.filter(i => i.type !== 'primary')) {
      await this._createIndex(table, idx)
    }
  }

  async alterTable(table, blueprint) {
    if (requiresTableRebuild(blueprint)) {
      await this._rebuildTable(table, blueprint)
      return
    }

    for (const col of blueprint.columns) {
      await this.db.prepare(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnToSQL(col)}`).run()
    }

    for (const idx of blueprint.indexes) {
      await this._createIndex(table, idx)
    }
  }

  async dropTable(table, { ifExists = false } = {}) {
    const guard = ifExists ? 'IF EXISTS ' : ''
    await this.db.prepare(`DROP TABLE ${guard}${quoteIdent(table)}`).run()
  }

  async renameTable(from, to) {
    await this.db.prepare(`ALTER TABLE ${quoteIdent(from)} RENAME TO ${quoteIdent(to)}`).run()
  }

  async truncate(table) {
    await this.db.prepare(`DELETE FROM ${quoteIdent(table)}`).run()
    try { await this.db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table) } catch { }
  }

  async hasTable(table) {
    return !!this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)
  }

  async hasColumn(table, column) {
    return this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().some(row => row.name === column)
  }

  async getColumnListing(table) {
    return this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map(row => row.name)
  }

  async toSQL(table, ctx) {
    return buildSelect(table, ctx)
  }

  // ── SQLITE TABLE REBUILD ───────────────────────────────────────────────────
  /**
   * SQLite cannot mutate most constraints, drop columns, or do arbitrary schema
   * changes in place. For those operations we create a replacement table, copy
   * compatible data across, swap the tables, then recreate indexes.
   */
  async _rebuildTable(table, blueprint) {
    const currentSchema = this._inspectTable(table)
    const nextSchema = applyBlueprintToSchema(table, currentSchema, blueprint)
    const tempTable = `__eloquent_tmp_${table}_${Date.now()}`
    const columnsToCopy = nextSchema.columns.filter(col => col.copyFrom)

    execSql(this.db, 'PRAGMA foreign_keys = OFF')
    this.db.prepare('BEGIN').run()

    try {
      this.db.prepare(buildCreateTableSQL(tempTable, nextSchema.columns, nextSchema.foreigns, nextSchema.indexes)).run()
      copyTableData(this.db, table, tempTable, columnsToCopy)

      this.db.prepare(`DROP TABLE ${quoteIdent(table)}`).run()
      this.db.prepare(`ALTER TABLE ${quoteIdent(tempTable)} RENAME TO ${quoteIdent(table)}`).run()

      for (const idx of nextSchema.indexes.filter(i => i.type === 'unique' || i.type === 'index')) {
        await this._createIndex(table, idx)
      }

      const violations = this.db.prepare('PRAGMA foreign_key_check').all()
      if (violations.length) throw new Error(`[EloquentJS/sqlite] Foreign key check failed after rebuilding ${table}`)

      this.db.prepare('COMMIT').run()
    } catch (err) {
      this.db.prepare('ROLLBACK').run()
      throw err
    } finally {
      execSql(this.db, 'PRAGMA foreign_keys = ON')
    }
  }

  _inspectTable(table) {
    const columns = this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map(col => ({
      name: col.name,
      sql: inspectedColumnToSQL(col),
      copyFrom: col.name,
      primaryKey: col.pk > 0,
    }))

    return {
      columns,
      foreigns: inspectForeignKeys(this.db, table),
      indexes: inspectIndexes(this.db, table),
    }
  }

  async _createIndex(table, idx) {
    if (idx.type !== 'unique' && idx.type !== 'index') return

    const name = idx.name ?? `${table}_${idx.columns.join('_')}_${idx.type}`
    const cols = idx.columns.map(quoteIdent).join(', ')
    const unique = idx.type === 'unique' ? 'UNIQUE ' : ''
    await this.db.prepare(`CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})`).run()
  }
}

// ─── SQL Builder ─────────────────────────────────────────────────────────────
function quoteIdent(name) {
  if (!name || name === '*') return name
  if (name.startsWith('"') && name.endsWith('"')) return name
  if (name.includes('.')) return name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.')
  return `"${name.replace(/"/g, '""')}"`
}

function toSqlitePlaceholders(sql) {
  return sql.replace(/\$\d+/g, '?')
}

function isReader(stmt, sql) {
  if (typeof stmt.reader === 'boolean') return stmt.reader
  return /^\s*(select|with|pragma\s+(?!.*=))/i.test(sql)
}

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
      sql += ` ${j.type} JOIN ${quoteIdent(j.table)} ON ${quoteIdent(j.first)} ${j.operator} ${quoteIdent(j.second)}`
    }
  }

  const { clause: whereClause, whereParams } = buildWhereClauses(ctx)
  if (whereClause) {
    sql += ` WHERE ${whereClause}`
    params.push(...whereParams)
  }

  if (ctx.groupBys?.length) {
    sql += ` GROUP BY ${ctx.groupBys.map(quoteIdent).join(', ')}`
  }

  const havingParts = []
  for (const h of ctx.havings ?? []) {
    havingParts.push(`${quoteIdent(h.column)} ${h.operator} ?`)
    params.push(prepareValue(h.value))
  }
  if (havingParts.length) sql += ` HAVING ${havingParts.join(' AND ')}`

  const orderParts = (ctx.orderBys ?? []).map(o => {
    if (o.raw) return o.raw
    if (o.random) return 'RANDOM()'
    return `${quoteIdent(o.column)} ${o.direction}`
  })
  if (orderParts.length) sql += ` ORDER BY ${orderParts.join(', ')}`

  if (ctx.limit != null) { params.push(ctx.limit); sql += ' LIMIT ?' }
  if (ctx.offset != null) { params.push(ctx.offset); sql += ' OFFSET ?' }

  return { sql, params }
}

function buildWhereClauses(ctx) {
  const whereParams = []
  const parts = []
  const push = (v) => { whereParams.push(prepareValue(v)); return '?' }

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
        clause = `date(${quoteIdent(w.column)}) ${w.operator} ${push(w.value)}`
        break
      case 'year':
        clause = `strftime('%Y', ${quoteIdent(w.column)}) = ${push(String(w.value))}`
        break
      case 'month':
        clause = `strftime('%m', ${quoteIdent(w.column)}) = ${push(String(w.value).padStart(2, '0'))}`
        break
      case 'day':
        clause = `strftime('%d', ${quoteIdent(w.column)}) = ${push(String(w.value).padStart(2, '0'))}`
        break
      case 'jsonContains':
        clause = buildJsonContainsClause(w.column, w.value, push)
        break
      default:
        clause = `${quoteIdent(w.column)} ${w.operator} ${push(w.value)}`
    }

    parts.push({ bool, clause })
  }

  for (const rw of ctx.rawWheres ?? []) {
    for (const b of rw.bindings) whereParams.push(prepareValue(b))
    parts.push({ bool: 'AND', clause: rw.sql })
  }

  if (!parts.length) return { clause: '', whereParams }

  let clause = parts[0].clause
  for (let i = 1; i < parts.length; i++) {
    clause += ` ${parts[i].bool} ${parts[i].clause}`
  }
  return { clause, whereParams }
}

function buildJsonContainsClause(column, value, push) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const parts = Object.entries(value).map(([key, val]) => {
      return `json_extract(${quoteIdent(column)}, ${push(`$.${key.replace(/"/g, '\\"')}`)}) = ${push(val)}`
    })
    return parts.length ? `(${parts.join(' AND ')})` : '1=1'
  }

  if (Array.isArray(value)) {
    const parts = value.map(item => `EXISTS (SELECT 1 FROM json_each(${quoteIdent(column)}) WHERE value = ${push(item)})`)
    return parts.length ? `(${parts.join(' AND ')})` : '1=1'
  }

  return `json_extract(${quoteIdent(column)}, '$') = ${push(value)}`
}

// ─── DDL Helpers ─────────────────────────────────────────────────────────────
const SQLITE_TYPE_MAP = {
  bigIncrements: 'INTEGER',
  increments: 'INTEGER',
  bigInteger: 'INTEGER',
  integer: 'INTEGER',
  smallInteger: 'INTEGER',
  tinyInteger: 'INTEGER',
  float: 'REAL',
  double: 'REAL',
  text: 'TEXT',
  boolean: 'INTEGER',
  date: 'TEXT',
  time: 'TEXT',
  dateTime: 'TEXT',
  timestamp: 'TEXT',
  timestampTz: 'TEXT',
  year: 'INTEGER',
  json: 'TEXT',
  jsonb: 'TEXT',
  uuid: 'TEXT',
  binary: 'BLOB',
}

function columnToSQL(col) {
  let sqlType

  switch (col.type) {
    case 'string':
    case 'char':
      sqlType = 'TEXT'
      break
    case 'decimal':
      sqlType = 'NUMERIC'
      break
    case 'enum':
      sqlType = `TEXT CHECK (${quoteIdent(col.name)} IN (${(col.enumValues ?? []).map(v => `'${v.replace(/'/g, "''")}'`).join(', ')}))`
      break
    default:
      sqlType = SQLITE_TYPE_MAP[col.type] ?? col.type.toUpperCase()
  }

  let def = `${quoteIdent(col.name)} ${sqlType}`
  if (['bigIncrements', 'increments'].includes(col.type)) def += ' PRIMARY KEY AUTOINCREMENT'
  else if (col.primaryKey) def += ' PRIMARY KEY'
  if (!col._nullable && !col.primaryKey && !['bigIncrements', 'increments'].includes(col.type)) def += ' NOT NULL'
  if (col._default !== undefined && col._default !== null) def += ` DEFAULT ${formatDefault(col._default)}`
  if (col._unique) def += ' UNIQUE'
  return def
}

function inspectedColumnToSQL(col) {
  let def = `${quoteIdent(col.name)} ${col.type || 'TEXT'}`
  if (col.pk > 0) def += ' PRIMARY KEY'
  if (col.notnull && !col.pk) def += ' NOT NULL'
  if (col.dflt_value != null) def += ` DEFAULT ${col.dflt_value}`
  return def
}

function buildCreateTableSQL(table, columns, foreigns = [], indexes = []) {
  const colDefs = columns.map(col => col.sql)
  const primaryKeys = indexes
    .filter(i => i.type === 'primary')
    .map(i => `PRIMARY KEY (${i.columns.map(quoteIdent).join(', ')})`)
  const foreignKeys = foreigns.map(foreignKeyToSQL)

  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${[...colDefs, ...primaryKeys, ...foreignKeys].join(',\n  ')}\n)`
}

function foreignKeyToSQL(fk) {
  const columns = [fk.column].flat().map(quoteIdent).join(', ')
  const references = [fk.references ?? 'id'].flat().map(quoteIdent).join(', ')
  const onDel = (fk.onDelete ?? 'RESTRICT').toUpperCase()
  const onUpd = (fk.onUpdate ?? 'CASCADE').toUpperCase()
  return `FOREIGN KEY (${columns}) REFERENCES ${quoteIdent(fk.table)} (${references}) ON DELETE ${onDel} ON UPDATE ${onUpd}`
}

function requiresTableRebuild(blueprint) {
  if (blueprint.drops.length || blueprint.renames.length || blueprint.foreigns.length) return true
  if (blueprint.columns.some(col => col.primaryKey || col._unique)) return true
  return blueprint.indexes.some(idx => idx.type === 'dropIndex' || idx.type === 'dropUnique' || idx.type === 'dropPrimary' || idx.type === 'primary')
}

// ─── SQLite Rebuild Helpers ──────────────────────────────────────────────────
function inspectForeignKeys(db, table) {
  const rows = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all()
  const groups = new Map()

  for (const row of rows) {
    if (!groups.has(row.id)) groups.set(row.id, [])
    groups.get(row.id).push(row)
  }

  return [...groups.values()].map(group => {
    const sorted = group.sort((a, b) => a.seq - b.seq)
    const columns = sorted.map(row => row.from)
    const references = sorted.map(row => row.to)

    return {
      column: columns.length === 1 ? columns[0] : columns,
      table: sorted[0].table,
      references: references.length === 1 ? references[0] : references,
      onDelete: sorted[0].on_delete,
      onUpdate: sorted[0].on_update,
    }
  })
}

function inspectIndexes(db, table) {
  const indexes = []

  for (const idx of db.prepare(`PRAGMA index_list(${quoteIdent(table)})`).all()) {
    if (idx.origin === 'pk') continue

    const columns = db.prepare(`PRAGMA index_info(${quoteIdent(idx.name)})`).all().map(row => row.name)
    indexes.push({
      type: idx.unique ? 'unique' : 'index',
      name: idx.name.startsWith('sqlite_autoindex') ? undefined : idx.name,
      table,
      columns,
    })
  }

  return indexes
}

function copyTableData(db, sourceTable, targetTable, columnsToCopy) {
  if (!columnsToCopy.length) return

  const targetCols = columnsToCopy.map(col => quoteIdent(col.name)).join(', ')
  const sourceCols = columnsToCopy.map(col => quoteIdent(col.copyFrom)).join(', ')
  db.prepare(`INSERT INTO ${quoteIdent(targetTable)} (${targetCols}) SELECT ${sourceCols} FROM ${quoteIdent(sourceTable)}`).run()
}

function applyBlueprintToSchema(table, currentSchema, blueprint) {
  const dropColumns = new Set(blueprint.drops)
  const renames = new Map(blueprint.renames.map(({ from, to }) => [from, to]))
  const dropPrimary = blueprint.indexes.some(idx => idx.type === 'dropPrimary')

  const columns = currentSchema.columns
    .filter(col => !dropColumns.has(col.name))
    .map(col => {
      const name = renames.get(col.name) ?? col.name
      return {
        ...col,
        name,
        sql: renameColumnSQL(col.sql, col.name, name, dropPrimary),
        copyFrom: col.name,
      }
    })

  for (const col of blueprint.columns) {
    columns.push({ name: col.name, sql: columnToSQL(col), copyFrom: null, primaryKey: !!col.primaryKey })
  }

  const foreigns = currentSchema.foreigns
    .filter(fk => !isForeignKeyDropped(table, fk, blueprint.foreigns))
    .map(fk => renameForeignKeyColumns(fk, renames))

  foreigns.push(...blueprint.foreigns.filter(fk => !fk.drop))

  const indexes = currentSchema.indexes
    .filter(idx => !isIndexDropped(idx, blueprint.indexes))
    .map(idx => ({ ...idx, columns: idx.columns.map(col => renames.get(col) ?? col) }))

  indexes.push(...blueprint.indexes.filter(idx => idx.type === 'index' || idx.type === 'unique' || idx.type === 'primary'))

  return { columns, foreigns, indexes }
}

function renameColumnSQL(sql, from, to, dropPrimary) {
  let next = sql.replace(quoteIdent(from), quoteIdent(to))
  if (dropPrimary) next = next.replace(/\s+PRIMARY KEY\b/i, '')
  return next
}

function renameForeignKeyColumns(fk, renames) {
  const rename = col => renames.get(col) ?? col
  const column = Array.isArray(fk.column) ? fk.column.map(rename) : rename(fk.column)
  return { ...fk, column }
}

function isForeignKeyDropped(table, fk, foreignOps) {
  const columns = [fk.column].flat()
  const names = new Set(columns.flatMap(column => [column, generatedForeignKeyName(table, column)]).map(name => String(name).toLowerCase()))

  return foreignOps
    .filter(op => op.drop)
    .some(op => [op.name].flat().some(name => names.has(String(name).toLowerCase())))
}

function generatedForeignKeyName(table, column) {
  return `${table}_${column}_foreign`
}

function isIndexDropped(index, indexOps) {
  const generatedNames = [index.name, generatedIndexName(index)].filter(Boolean)
  return indexOps
    .filter(op => op.type === 'dropIndex' || op.type === 'dropUnique')
    .some(op => generatedNames.includes(op.name))
}

function generatedIndexName(index) {
  if (!index.columns?.length) return null
  return `${index.table}_${index.columns.join('_')}_${index.type}`
}

// ─── Value Helpers ───────────────────────────────────────────────────────────
function prepareValue(value) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value
}

function formatDefault(value) {
  if (typeof value === 'string') return /^[A-Z_]+\(?.*\)?$/.test(value) ? value : `'${value.replace(/'/g, "''")}'`
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

function execSql(db, sql) {
  if (typeof db.exec === 'function') return db.exec(sql)
  return db.prepare(sql).run()
}

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

// ─── TransactionClient ───────────────────────────────────────────────────────
class TransactionClient {
  constructor(db) { this._db = db }

  async query(sql, params = []) {
    const stmt = this._db.prepare(toSqlitePlaceholders(sql))
    if (isReader(stmt, sql)) return { rows: stmt.all(...params), rowCount: 0 }
    const result = stmt.run(...params)
    return { rows: [], rowCount: result.changes }
  }

  prepare(sql) { return this._db.prepare(sql) }
}
