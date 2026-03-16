/**
 * @eloquentjs/core — Schema & Migration
 */
import { getResolver } from './ConnectionRegistry.js'

// ─── Blueprint ───────────────────────────────────────────────────────────────
export class Blueprint {
  constructor(table, mode = 'create') {
    this.tableName = table
    this.mode      = mode
    this.columns   = []
    this.indexes   = []
    this.foreigns  = []
    this.drops     = []
    this.renames   = []
  }

  // ─── Primary key ──────────────────────────────────────────────────────────
  id(column = 'id')        { return this._col({ name: column, type: 'bigIncrements', primaryKey: true }) }
  uuid(column = 'id')      { return this._col({ name: column, type: 'uuid',          primaryKey: true }).default('gen_random_uuid()') }
  bigIncrements(col)       { return this._col({ name: col, type: 'bigIncrements', primaryKey: true }) }
  increments(col)          { return this._col({ name: col, type: 'increments',    primaryKey: true }) }

  // ─── Strings ──────────────────────────────────────────────────────────────
  string(col, len = 255)   { return this._col({ name: col, type: 'string',   length: len }) }
  char(col, len = 1)       { return this._col({ name: col, type: 'char',     length: len }) }
  text(col)                { return this._col({ name: col, type: 'text' }) }
  longText(col)            { return this._col({ name: col, type: 'text' }) }
  tinyText(col)            { return this._col({ name: col, type: 'text' }) }

  // ─── Numeric ──────────────────────────────────────────────────────────────
  integer(col)             { return this._col({ name: col, type: 'integer' }) }
  bigInteger(col)          { return this._col({ name: col, type: 'bigInteger' }) }
  smallInteger(col)        { return this._col({ name: col, type: 'smallInteger' }) }
  tinyInteger(col)         { return this._col({ name: col, type: 'tinyInteger' }) }
  unsignedInteger(col)     { return this._col({ name: col, type: 'integer',    unsigned: true }) }
  unsignedBigInteger(col)  { return this._col({ name: col, type: 'bigInteger', unsigned: true }) }
  float(col)               { return this._col({ name: col, type: 'float' }) }
  double(col)              { return this._col({ name: col, type: 'double' }) }
  decimal(col, p = 8, s = 2) { return this._col({ name: col, type: 'decimal', precision: p, scale: s }) }

  // ─── Boolean / Date / Binary ──────────────────────────────────────────────
  boolean(col)    { return this._col({ name: col, type: 'boolean' }) }
  date(col)       { return this._col({ name: col, type: 'date' }) }
  time(col)       { return this._col({ name: col, type: 'time' }) }
  dateTime(col)   { return this._col({ name: col, type: 'dateTime' }) }
  timestamp(col)  { return this._col({ name: col, type: 'timestamp' }) }
  timestampTz(col){ return this._col({ name: col, type: 'timestampTz' }) }
  year(col)       { return this._col({ name: col, type: 'year' }) }
  binary(col)     { return this._col({ name: col, type: 'binary' }) }

  // ─── JSON ─────────────────────────────────────────────────────────────────
  json(col)   { return this._col({ name: col, type: 'json' }) }
  jsonb(col)  { return this._col({ name: col, type: 'jsonb' }) }

  // ─── Enum ─────────────────────────────────────────────────────────────────
  enum(col, values) { return this._col({ name: col, type: 'enum', enumValues: values }) }

  // ─── UUID ─────────────────────────────────────────────────────────────────
  uuidColumn(col)  { return this._col({ name: col, type: 'uuid' }) }

  // ─── Conveniences ─────────────────────────────────────────────────────────
  timestamps() {
    this._col({ name: 'created_at', type: 'timestamp' }).nullable()
    this._col({ name: 'updated_at', type: 'timestamp' }).nullable()
    return this
  }

  softDeletes(col = 'deleted_at') {
    return this._col({ name: col, type: 'timestamp' }).nullable()
  }

  rememberToken() {
    return this._col({ name: 'remember_token', type: 'string', length: 100 }).nullable()
  }

  morphs(name) {
    this.string(`${name}_type`)
    this.unsignedBigInteger(`${name}_id`)
    this.index([`${name}_type`, `${name}_id`])
    return this
  }

  nullableMorphs(name) {
    this.string(`${name}_type`).nullable()
    this.unsignedBigInteger(`${name}_id`).nullable()
    return this
  }

  // ─── Foreign key shorthand ────────────────────────────────────────────────
  foreignId(col) {
    const colDef = this._col({ name: col, type: 'bigInteger', unsigned: true })

    colDef.constrained = (table, references = 'id') => {
      this.foreigns.push({
        column: col, table, references,
        onDelete: 'RESTRICT', onUpdate: 'CASCADE',
      })
      return colDef
    }
    colDef.cascadeOnDelete = () => {
      const f = this.foreigns.find(f => f.column === col)
      if (f) f.onDelete = 'CASCADE'
      return colDef
    }
    colDef.nullOnDelete = () => {
      const f = this.foreigns.find(f => f.column === col)
      if (f) f.onDelete = 'SET NULL'
      return colDef
    }
    colDef.restrictOnDelete = () => {
      const f = this.foreigns.find(f => f.column === col)
      if (f) f.onDelete = 'RESTRICT'
      return colDef
    }
    return colDef
  }

  foreign(col) {
    const def = { column: col }
    const chain = {
      references(c)  { def.references = c; return chain },
      on(table)      { def.table = table; this._blueprint.foreigns.push(def); return chain },
      onDelete(a)    { def.onDelete = a.toUpperCase(); return chain },
      onUpdate(a)    { def.onUpdate = a.toUpperCase(); return chain },
    }
    chain._blueprint = this
    return chain
  }

  // ─── Indexes ──────────────────────────────────────────────────────────────
  index(columns, name)   { this.indexes.push({ type: 'index',  columns: [columns].flat(), name }); return this }
  unique(columns, name)  { this.indexes.push({ type: 'unique', columns: [columns].flat(), name }); return this }
  primary(columns, name) { this.indexes.push({ type: 'primary',columns: [columns].flat(), name }); return this }

  // ─── Alter helpers ────────────────────────────────────────────────────────
  dropColumn(...cols)        { this.drops.push(...cols.flat()); return this }
  renameColumn(from, to)     { this.renames.push({ from, to }); return this }
  dropIndex(name)            { this.indexes.push({ type: 'dropIndex',  name }); return this }
  dropUnique(name)           { this.indexes.push({ type: 'dropUnique', name }); return this }
  dropForeign(nameOrCol)     { this.foreigns.push({ drop: true, name: nameOrCol }); return this }
  dropPrimary()              { this.indexes.push({ type: 'dropPrimary' }); return this }
  dropTimestamps()           { this.drops.push('created_at', 'updated_at'); return this }
  dropSoftDeletes(col = 'deleted_at') { this.drops.push(col); return this }

  // ─── Internal column builder ──────────────────────────────────────────────
  _col(def) {
    const col = Object.assign({
      _nullable: false,
      _default:  undefined,
      _unique:   false,
      _after:    null,
      _comment:  null,
      // Chainable modifiers:
      nullable()      { this._nullable = true; return this },
      default(val)    { this._default = val; return this },
      unique()        { this._unique = true; return this },
      after(col)      { this._after = col; return this },
      comment(text)   { this._comment = text; return this },
      unsigned()      { this.unsigned = true; return this },
      useCurrent()    { this._default = 'CURRENT_TIMESTAMP'; return this },
      index()         { /* handled at table level */ return this },
    }, def)

    this.columns.push(col)
    return col
  }
}

// ─── Schema ──────────────────────────────────────────────────────────────────
export const Schema = {
  async create(table, cb, connection = 'default') {
    const bp = new Blueprint(table, 'create')
    cb(bp)
    return getResolver(connection).createTable(table, bp)
  },

  async table(table, cb, connection = 'default') {
    const bp = new Blueprint(table, 'alter')
    cb(bp)
    return getResolver(connection).alterTable(table, bp)
  },

  async drop(table, connection = 'default') {
    return getResolver(connection).dropTable(table)
  },

  async dropIfExists(table, connection = 'default') {
    return getResolver(connection).dropTable(table, { ifExists: true })
  },

  async rename(from, to, connection = 'default') {
    return getResolver(connection).renameTable(from, to)
  },

  async hasTable(table, connection = 'default') {
    return getResolver(connection).hasTable(table)
  },

  async hasColumn(table, column, connection = 'default') {
    return getResolver(connection).hasColumn(table, column)
  },

  async getColumnListing(table, connection = 'default') {
    return getResolver(connection).getColumnListing(table)
  },
}

// ─── Migration ───────────────────────────────────────────────────────────────
export class Migration {
  async up()   { throw new Error(`${this.constructor.name}.up() must be implemented`) }
  async down() { throw new Error(`${this.constructor.name}.down() must be implemented`) }
}
