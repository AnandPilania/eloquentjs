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
 *
 * One instance per cast class is shared, so `this` inside a cast is stable.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { Collection } from './Collection.js'

/** @type {Map<string, {get: (v: any) => any, set: (v: any) => any, serialize?: (v: any) => any}>} */
const _custom = new Map()

/**
 * One instance per cast class. Casts are stateless value objects, and
 * instantiating on every attribute read (which is what `new handler().get(v)`
 * did) both allocated per access and gave classes two different lifetimes
 * depending on whether they came from register() or `static casts`.
 * @type {Map<Function, {get: (v: any) => any, set: (v: any) => any, serialize?: (v: any) => any}>}
 */
const _instances = new Map()

function instanceOf(CastClass) {
  let instance = _instances.get(CastClass)
  if (!instance) _instances.set(CastClass, instance = new CastClass())
  return instance
}

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
  /** An immutable Date — reads return a frozen copy, so mutation can't leak. */
  immutable_date: {
    get(v) {
      const d = _builtins.date.get(v)
      return d instanceof Date ? Object.freeze(new Date(d.getTime())) : d
    },
    set: v => _builtins.date.set(v),
    serialize: v => _builtins.date.serialize(v),
  },
  /**
   * A write-only hash: set() hashes, get() returns the stored hash unchanged.
   * scrypt via node:crypto — no dependency, and `verifyHashed()` below is the
   * matching check.
   */
  hashed: {
    get: v => v,
    set(v) {
      if (v == null || v === '') return v
      if (typeof v === 'string' && v.startsWith('scrypt$')) return v   // already hashed
      const salt = randomBytes(16)
      const hash = scryptSync(String(v), salt, 64)
      return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
    },
    serialize: () => undefined,   // never serialise a hash
  },
}

_builtins.immutable_datetime = _builtins.immutable_date

/**
 * Verify a plaintext value against a `hashed` cast column.
 * @param {string} plain
 * @param {string} stored
 */
export function verifyHashed(plain, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false
  const [, salt, hash] = stored.split('$')
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(String(plain), Buffer.from(salt, 'base64'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/**
 * A cast backed by a plain-object or TS-style enum: stores the value, reads
 * back only values the enum contains.
 *   static casts = { status: AsEnum({ Draft: 'draft', Live: 'live' }) }
 */
export function AsEnum(enumObject) {
  const values = new Set(Object.values(enumObject))
  return {
    get: v => (v == null || values.has(v) ? v : undefined),
    set(v) {
      if (v == null) return v
      if (!values.has(v)) {
        throw new Error(`[EloquentJS] "${v}" is not a valid value; expected one of ${[...values].join(', ')}`)
      }
      return v
    },
    serialize: v => v,
  }
}

/**
 * A JSON array column read back as a Collection — Laravel's AsCollection.
 * Used bare, not called: `static casts = { tags: AsCollection }`
 */
export const AsCollection = {
  get(v) {
    const parsed = _builtins.json.get(v)
    if (parsed == null) return parsed
    return parsed instanceof Collection ? parsed : new Collection([parsed].flat())
  },
  set(v) {
    if (v == null) return v
    if (typeof v === 'string') return v
    return JSON.stringify(v instanceof Collection ? [...v] : v)
  },
  // A Collection is an Array subclass, so JSON.stringify already handles it;
  // spreading keeps toJSON() output a plain array rather than a Collection.
  serialize(v) {
    const parsed = AsCollection.get(v)
    return parsed instanceof Collection ? [...parsed] : parsed
  },
}

/**
 * A JSON object column read back as a mutable object — the JS reading of
 * Laravel's AsArrayObject. Null reads back as `{}` so `model.options.x = 1`
 * never throws.
 *
 * ponytail: a plain object already has ArrayObject's reference semantics, so
 * there is no wrapper class. The one thing it cannot do is notice an in-place
 * mutation — `model.options.x = 1` will not mark the attribute dirty. Reassign
 * (`model.options = {...model.options, x: 1}`) when you need save() to see it.
 */
export const AsArrayObject = {
  get: v => _builtins.json.get(v) ?? {},
  set: v => _builtins.json.set(v),
  serialize: v => _builtins.json.serialize(v) ?? {},
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
   * @param {string} name
   * @param {new (...args: any[]) => {get: (v: any) => any, set: (v: any) => any, serialize?: (v: any) => any}} CastClass  - class with get/set/serialize methods
   */
  register(name, CastClass) {
    _custom.set(name.toLowerCase(), instanceOf(CastClass))
  },

  /** Read-phase cast (model attribute access). */
  get(type, value) {
    const handler = type ? this._resolve(type) : null
    return handler ? handler.get(value) : value
  },

  /** Write-phase cast (attribute assignment). */
  set(type, value) {
    const handler = type ? this._resolve(type) : null
    return handler ? handler.set(value) : value
  },

  /** Serialization cast (toJSON). */
  serialize(type, value) {
    const handler = type ? this._resolve(type) : null
    if (!handler) return value
    // Bound, so a custom cast whose serialize() uses `this` works. Reading
    // `new handler().serialize ?? new handler().get` created two instances and
    // returned an unbound method.
    return handler.serialize
      ? handler.serialize(value)
      : handler.get(value)
  },

  /** @returns {{get: Function, set: Function, serialize?: Function}|null} */
  _resolve(type) {
    // Class-based cast (constructor function) — one shared instance.
    if (typeof type === 'function') return instanceOf(type)
    if (type && typeof type === 'object') return type   // inline {get,set} object
    if (typeof type !== 'string') return null

    // `decimal:N` — parsed before the alias lookup, and tolerant of a missing N.
    if (type.startsWith('decimal:') || type === 'decimal') {
      const places = parseInt(type.split(':')[1] ?? '2', 10) || 0
      const round = v => (v == null ? v : parseFloat(Number(v).toFixed(places)))
      return {
        get: round,
        set: round,
        // Laravel returns decimals as a fixed-precision string so they survive
        // JSON without float drift.
        serialize: v => (v == null ? v : Number(v).toFixed(places)),
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
