/**
 * @eloquentjs/core — CastRegistry
 *
 * Built-in casts + extensible custom cast classes.
 *
 * Model usage:
 *   static casts = {
 *     is_admin:   'boolean',
 *     created_at: 'date',
 *     settings:   'json',
 *     price:      'decimal:2',
 *     role:       RoleCast,        // custom cast class
 *   }
 *
 * Custom cast must implement:
 *   get(value)        — called when reading from model
 *   set(value)        — called when writing to model (mutator)
 *   serialize(value)  — called during toJSON()
 */

/** @type {Map<string, {get, set, serialize}>} */
const _custom = new Map()

// ─── Built-in cast definitions ────────────────────────────────────────────────
const _builtins = {
  integer: {
    get: v => (v == null ? v : parseInt(v, 10)),
    set: v => (v == null ? v : parseInt(v, 10)),
    serialize: v => (v == null ? v : parseInt(v, 10)),
  },
  float: {
    get: v => (v == null ? v : parseFloat(v)),
    set: v => (v == null ? v : parseFloat(v)),
    serialize: v => (v == null ? v : parseFloat(v)),
  },
  string: {
    get: v => (v == null ? v : String(v)),
    set: v => (v == null ? v : String(v)),
    serialize: v => (v == null ? v : String(v)),
  },
  boolean: {
    get: v => (v == null ? v : (v === '0' || v === 'false' ? false : Boolean(v))),
    set: v => (v == null ? v : Boolean(v)),
    serialize: v => (v == null ? v : Boolean(v)),
  },
  date: {
    get(v) {
      if (v == null) return v
      if (v instanceof Date) return v
      const d = new Date(v)
      return isNaN(d.getTime()) ? v : d
    },
    set(v) {
      if (v == null) return v
      if (v instanceof Date) return v
      const d = new Date(v)
      return isNaN(d.getTime()) ? v : d
    },
    serialize(v) {
      if (v == null) return v
      if (v instanceof Date) return v.toISOString()
      return v
    },
  },
  json: {
    get(v) {
      if (v == null || typeof v === 'object') return v
      try { return JSON.parse(v) } catch { return v }
    },
    set(v) {
      if (v == null || typeof v === 'string') return v
      return JSON.stringify(v)
    },
    serialize(v) {
      if (v == null) return v
      if (typeof v === 'string') { try { return JSON.parse(v) } catch {} }
      return v
    },
  },
  uuid: {
    get: v => v,
    set: v => v,
    serialize: v => v,
  },
  binary: {
    get: v => v,
    set: v => v,
    serialize: v => (v instanceof Buffer ? v.toString('base64') : v),
  },
}

// ─── Aliases ─────────────────────────────────────────────────────────────────
_builtins.int         = _builtins.integer
_builtins.biginteger  = _builtins.integer
_builtins.double      = _builtins.float
_builtins.real        = _builtins.float
_builtins.bool        = _builtins.boolean
_builtins.datetime    = _builtins.date
_builtins.timestamp   = _builtins.date
_builtins.array       = _builtins.json
_builtins.object      = _builtins.json
_builtins.jsonb       = _builtins.json

// ─── CastRegistry ────────────────────────────────────────────────────────────
export const CastRegistry = {
  /**
   * Register a globally named custom cast.
   * @param {string}   name
   * @param {Function} CastClass  - class with get/set/serialize methods
   */
  register(name, CastClass) {
    _custom.set(name, new CastClass())
  },

  /** Read-phase cast (model attribute access). */
  get(type, value) {
    if (!type) return value
    const handler = this._resolve(type)
    if (!handler) return value
    return typeof handler === 'object'
      ? handler.get(value)
      : new handler().get(value)
  },

  /** Write-phase cast (attribute assignment). */
  set(type, value) {
    if (!type) return value
    const handler = this._resolve(type)
    if (!handler) return value
    return typeof handler === 'object'
      ? handler.set(value)
      : new handler().set(value)
  },

  /** Serialization cast (toJSON). */
  serialize(type, value) {
    if (!type) return value
    const handler = this._resolve(type)
    if (!handler) return value
    const fn = typeof handler === 'object'
      ? handler.serialize ?? handler.get
      : new handler().serialize ?? new handler().get
    return fn(value)
  },

  _resolve(type) {
    // Class-based cast (constructor function)
    if (typeof type === 'function') return type

    // decimal:N  syntax
    if (typeof type === 'string' && type.startsWith('decimal:')) {
      const places = parseInt(type.split(':')[1], 10)
      return {
        get: v => (v == null ? v : parseFloat(Number(v).toFixed(places))),
        set: v => (v == null ? v : parseFloat(Number(v).toFixed(places))),
        serialize: v => (v == null ? v : parseFloat(Number(v).toFixed(places))),
      }
    }

    const lower = type.toLowerCase()
    return _custom.get(lower) ?? _builtins[lower] ?? null
  },
}

// ─── Exported cast classes for convenience ───────────────────────────────────
export class DateCast {
  get(v)       { return _builtins.date.get(v) }
  set(v)       { return _builtins.date.set(v) }
  serialize(v) { return _builtins.date.serialize(v) }
}

export class JsonCast {
  get(v)       { return _builtins.json.get(v) }
  set(v)       { return _builtins.json.set(v) }
  serialize(v) { return _builtins.json.serialize(v) }
}

export class BooleanCast {
  get(v)       { return _builtins.boolean.get(v) }
  set(v)       { return _builtins.boolean.set(v) }
  serialize(v) { return _builtins.boolean.serialize(v) }
}
