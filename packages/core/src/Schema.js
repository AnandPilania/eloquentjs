/**
 * @eloquentjs/core — Schema & Migration
 */
import { getResolver } from './ConnectionRegistry.js'

/**
 * Portable default expressions. Core must not emit driver SQL — each driver
 * renders these markers itself (pgsql: gen_random_uuid(); sqlite: randomblob).
 * Use them via `.default(Expr.uuid)` or the shorthands below.
 */
export const Expr = {
  uuid: { expr: 'uuid' },
  now: { expr: 'now' },
  today: { expr: 'today' },
}

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
    /** Columns redefined via ->change(); drivers ALTER rather than ADD these. */
    this.changes   = []
  }

  // ─── Primary key ──────────────────────────────────────────────────────────
  id(column = 'id')        { return this._col({ name: column, type: 'bigIncrements', primaryKey: true }) }
  uuid(column = 'id')      { return this._col({ name: column, type: 'uuid',          primaryKey: true }).default(Expr.uuid) }
  bigIncrements(col)       { return this._col({ name: col, type: 'bigIncrements', primaryKey: true }) }
  increments(col)          { return this._col({ name: col, type: 'increments',    primaryKey: true }) }

  // ─── Strings ──────────────────────────────────────────────────────────────
  string(col, len = 255)   { return this._col({ name: col, type: 'string',   length: len }) }
  char(col, len = 1)       { return this._col({ name: col, type: 'char',     length: len }) }
  text(col)                { return this._col({ name: col, type: 'text' }) }
  mediumText(col)          { return this._col({ name: col, type: 'mediumText' }) }
  longText(col)            { return this._col({ name: col, type: 'longText' }) }
  tinyText(col)            { return this._col({ name: col, type: 'tinyText' }) }

  // ─── Numeric ──────────────────────────────────────────────────────────────
  integer(col)             { return this._col({ name: col, type: 'integer' }) }
  bigInteger(col)          { return this._col({ name: col, type: 'bigInteger' }) }
  smallInteger(col)        { return this._col({ name: col, type: 'smallInteger' }) }
  tinyInteger(col)         { return this._col({ name: col, type: 'tinyInteger' }) }
  unsignedInteger(col)     { return this._col({ name: col, type: 'integer',    _unsigned: true }) }
  unsignedBigInteger(col)  { return this._col({ name: col, type: 'bigInteger', _unsigned: true }) }
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
    const colDef = this._col({ name: col, type: 'bigInteger', _unsigned: true })

    // The referential actions are recorded on the column and copied onto the
    // constraint by constrained(), so `.cascadeOnDelete().constrained('roles')`
    // works in either order — it used to silently do nothing before constrained().
    const pending = { onDelete: 'RESTRICT', onUpdate: 'CASCADE' }
    const setAction = (key, action) => {
      pending[key] = action
      const f = this.foreigns.find(f => f.column === col && !f.drop)
      if (f) f[key] = action
      return colDef
    }

    colDef.constrained = (table, references = 'id') => {
      this.foreigns.push({ column: col, table, references, ...pending })
      return colDef
    }
    colDef.references = (references) => {
      colDef._references = references
      return {
        on: (table) => {
          this.foreigns.push({ column: col, table, references, ...pending })
          return colDef
        },
      }
    }
    colDef.cascadeOnDelete = () => setAction('onDelete', 'CASCADE')
    colDef.nullOnDelete = () => setAction('onDelete', 'SET NULL')
    colDef.restrictOnDelete = () => setAction('onDelete', 'RESTRICT')
    colDef.cascadeOnUpdate = () => setAction('onUpdate', 'CASCADE')
    colDef.restrictOnUpdate = () => setAction('onUpdate', 'RESTRICT')
    return colDef
  }

  foreignUuid(col) {
    const colDef = this.foreignId(col)
    colDef.type = 'uuid'
    colDef._unsigned = false
    return colDef
  }

  foreign(col) {
    const def = { column: col }
    const blueprint = this
    const chain = {
      references(c) { def.references = c; return chain },
      on(table) { def.table = table; blueprint.foreigns.push(def); return chain },
      onDelete(a) { def.onDelete = a.toUpperCase(); return chain },
      onUpdate(a) { def.onUpdate = a.toUpperCase(); return chain },
      cascadeOnDelete() { def.onDelete = 'CASCADE'; return chain },
      nullOnDelete() { def.onDelete = 'SET NULL'; return chain },
    }
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
  /**
   * @param {Record<string, any>} def
   * @returns {any} a plain column-def object plus chainable modifiers (nullable(), default(), ...)
   */
  _col(def) {
    const blueprint = this
    // Every flag is _-prefixed so a `def` key can never overwrite a modifier
    // method — `unsignedInteger('x').unsigned()` used to throw because
    // `unsigned: true` from the def clobbered the unsigned() function.
    const col = Object.assign(/** @type {any} */ ({
      _nullable: false,
      _default:  undefined,
      _unique:   false,
      _unsigned: false,
      _after:    null,
      _comment:  null,
      // Chainable modifiers:
      nullable(value = true) { this._nullable = value; return this },
      default(val)    { this._default = val; return this },
      // A named table-level index rather than an inline UNIQUE, so it can be
      // dropped later by dropUnique() and matches Laravel's naming.
      unique(name)    { blueprint.unique(this.name, name); return this },
      after(col)      { this._after = col; return this },
      comment(text)   { this._comment = text; return this },
      unsigned()      { this._unsigned = true; return this },
      useCurrent()    { this._default = Expr.now; return this },
      /** Register a real single-column index (used to be a no-op). */
      index(name)     { blueprint.index(this.name, name); return this },
      /**
       * Redefine an existing column instead of adding it.
       *   Schema.table('users', t => t.string('name', 500).change())
       */
      change() {
        const at = blueprint.columns.indexOf(this)
        if (at !== -1) blueprint.columns.splice(at, 1)
        blueprint.changes.push(this)
        return this
      },
    }), def)

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

  /**
   * @param {{cascade?: boolean}|string} [opts] cascade is opt-in — see
   * PgResolver.dropTable. A string is accepted as the connection name for
   * backwards compatibility.
   */
  async drop(table, opts = {}, connection = 'default') {
    const [o, c] = typeof opts === 'string' ? [{}, opts] : [opts, connection]
    return getResolver(c).dropTable(table, o)
  },

  async dropIfExists(table, opts = {}, connection = 'default') {
    const [o, c] = typeof opts === 'string' ? [{}, opts] : [opts, connection]
    return getResolver(c).dropTable(table, { ...o, ifExists: true })
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
