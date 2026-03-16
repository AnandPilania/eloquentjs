/**
 * @eloquentjs/core — Model
 *
 * Base model class. Subclass it to define your data layer.
 *
 *   class User extends Model {
 *     static table    = 'users'
 *     static fillable = ['name', 'email', 'password']
 *     static hidden   = ['password']
 *     static casts    = { is_admin: 'boolean', settings: 'json', created_at: 'date' }
 *
 *     posts()   { return this.hasMany(Post) }
 *     profile() { return this.hasOne(Profile) }
 *     roles()   { return this.belongsToMany(Role, 'user_roles') }
 *
 *     // Accessor
 *     getFullNameAttribute() { return `${this.first_name} ${this.last_name}` }
 *     // Mutator
 *     setPasswordAttribute(v) { return bcrypt.hashSync(v, 10) }
 *
 *     // Local scopes — accessed via User.scope('active') or User.active()
 *     static scopeActive(qb)       { return qb.where('active', true) }
 *     static scopeOlderThan(qb, n) { return qb.where('age', '>', n) }
 *
 *     // Lifecycle hooks
 *     static async creating(user) { user.slug = slugify(user.name) }
 *     static async created(user)  { await sendWelcome(user) }
 *   }
 */

import { randomUUID }       from 'crypto'
import { QueryBuilder }     from './QueryBuilder.js'
import { Collection }       from './Collection.js'
import { EventEmitter }     from './EventEmitter.js'
import { HookRegistry }     from './HookRegistry.js'
import { CastRegistry }     from './CastRegistry.js'
import { getResolver }      from './ConnectionRegistry.js'
import { ModelNotFoundException } from './errors.js'
import { RelationRegistry } from './relations/RelationRegistry.js'

// ─── Helpers (module-level, not exported) ────────────────────────────────────
function toSnakePlural(name) {
  const snake = name
    .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
    .replace(/^_/, '')
  return snake + 's'
}

function toPascalCase(str) {
  return str
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(s => s[0].toUpperCase() + s.slice(1))
    .join('')
}

// ─── Private state via WeakMap ───────────────────────────────────────────────
// Using WeakMap keyed on the RAW instance (not the proxy).
// The SELF symbol on each proxy points back to the raw instance,
// so all WeakMap lookups use the raw key regardless of proxy/target.
const _attrs    = new WeakMap()
const _original = new WeakMap()
const _rels     = new WeakMap()
const _exists   = new WeakMap()
const _trashed  = new WeakMap()
const SELF      = Symbol('self')  // proxy[SELF] → raw instance

// Get the raw (non-proxy) instance for WeakMap keying.
// Works whether `obj` is the proxy or the raw instance.
function raw(obj) { return obj[SELF] ?? obj }

// ─── Model ───────────────────────────────────────────────────────────────────
export class Model {
  // ─── Subclass overrides ────────────────────────────────────────────────────
  static table         = null      // defaults to snake_plural of class name
  static primaryKey    = 'id'
  static keyType       = 'integer' // 'integer' | 'uuid'
  static incrementing  = true

  static fillable      = []        // [] means nothing is fillable unless guarded is also []
  static guarded       = ['id']    // ['*'] to guard all; [] to allow all

  static casts         = {}
  static hidden        = []
  static visible       = []
  static appends       = []

  static timestamps        = true
  static createdAtColumn   = 'created_at'
  static updatedAtColumn   = 'updated_at'

  static softDeletes       = false
  static deletedAtColumn   = 'deleted_at'

  static globalScopes  = {}   // { name: qb => qb.where(...) }
  static connection    = 'default'

  // ─── Private instance state ────────────────────────────────────────────────
  // NOTE: Private fields are accessible across instances of the same class
  // but not through a Proxy wrapper. We use a WeakMap to safely store state
  // so the Proxy can delegate to the real instance without private-field
  // cross-instance access issues.
  //
  // We store everything in a plain object keyed by the model instance.
  // The Proxy target IS the model instance, so `this` inside class methods
  // refers to the Proxy, which forwards to the target. Private fields are
  // accessed on `target` (the real instance) inside the Proxy handler.

  // We define real private fields but access them only from methods defined
  // inside the class body — where JS allows it.

  constructor(attributes = {}) {
    // Fill attributes BEFORE wrapping in Proxy
    _attrs.set(raw(this), {})
    _original.set(raw(this), {})
    _rels.set(raw(this), {})
    _exists.set(raw(this), false)
    _trashed.set(raw(this), false)
    this._fillRaw(attributes)

    // Wrap in Proxy for transparent attribute access
    const proxy = new Proxy(this, modelProxyHandler)
    // Store raw instance on proxy so WeakMap lookups work via raw(proxy)
    proxy[SELF] = this
    return proxy
  }

  // ─── Static helpers ────────────────────────────────────────────────────────
  static getTable() {
    return this.table ?? toSnakePlural(this.name)
  }

  static getResolver() {
    return getResolver(this.connection)
  }

  // ─── Query builder factory ─────────────────────────────────────────────────
  static query() {
    const qb = new QueryBuilder(this, this.getResolver())

    // Apply global scopes (tag each where with _scope name for withoutGlobalScope)
    for (const [name, fn] of Object.entries(this.globalScopes)) {
      qb._globalScopes[name] = fn
      const before = qb._wheres.length
      fn(qb)
      // Tag the newly added wheres
      for (let i = before; i < qb._wheres.length; i++) {
        qb._wheres[i]._scope = name
      }
    }

    // Auto soft-delete filter
    if (this.softDeletes) {
      qb._wheres.push({ type: 'null', column: this.deletedAtColumn, boolean: 'and', _scope: '_softDelete' })
    }

    return qb
  }

  // ─── Scope proxy — makes User.active() work ────────────────────────────────
  // Returns a Proxy for the Model class itself. When a static property that
  // doesn't exist is accessed (e.g. .active), check for scopeActive method
  // and return a function that calls query().scopeActive().
  // ─── Static query shorthands ──────────────────────────────────────────────
  static where(...a)         { return this.query().where(...a) }
  static orWhere(...a)       { return this.query().orWhere(...a) }
  static whereIn(...a)       { return this.query().whereIn(...a) }
  static whereNotIn(...a)    { return this.query().whereNotIn(...a) }
  static whereNull(...a)     { return this.query().whereNull(...a) }
  static whereNotNull(...a)  { return this.query().whereNotNull(...a) }
  static whereNot(...a)         { return this.query().whereNot(...a) }
  static whereBetween(...a)     { return this.query().whereBetween(...a) }
  static whereNotBetween(...a)  { return this.query().whereNotBetween(...a) }
  static whereRaw(...a)         { return this.query().whereRaw(...a) }
  static whereLike(...a)        { return this.query().whereLike(...a) }
  static whereNotLike(...a)     { return this.query().whereNotLike(...a) }
  static whereDate(...a)        { return this.query().whereDate(...a) }
  static whereYear(...a)        { return this.query().whereYear(...a) }
  static whereMonth(...a)       { return this.query().whereMonth(...a) }
  static whereDay(...a)         { return this.query().whereDay(...a) }
  static whereJsonContains(...a){ return this.query().whereJsonContains(...a) }
  static select(...a)           { return this.query().select(...a) }
  static addSelect(...a)        { return this.query().addSelect(...a) }
  static orderBy(...a)          { return this.query().orderBy(...a) }
  static orderByDesc(c)         { return this.query().orderByDesc(c) }
  static inRandomOrder()        { return this.query().inRandomOrder() }
  static latest(c)              { return this.query().latest(c) }
  static oldest(c)              { return this.query().oldest(c) }
  static limit(n)               { return this.query().limit(n) }
  static take(n)                { return this.query().take(n) }
  static offset(n)              { return this.query().offset(n) }
  static skip(n)                { return this.query().skip(n) }
  static forPage(...a)          { return this.query().forPage(...a) }
  static with(...a)             { return this.query().with(...a) }
  static join(...a)             { return this.query().join(...a) }
  static leftJoin(...a)         { return this.query().leftJoin(...a) }
  static rightJoin(...a)        { return this.query().rightJoin(...a) }
  static crossJoin(...a)        { return this.query().crossJoin(...a) }
  static groupBy(...a)          { return this.query().groupBy(...a) }
  static having(...a)           { return this.query().having(...a) }
  static distinct()             { return this.query().distinct() }
  static withTrashed()          { return this.query().withTrashed() }
  static onlyTrashed()          { return this.query().onlyTrashed() }

  static async all()         { return this.query().get() }
  static async get()         { return this.query().get() }
  static async first()       { return this.query().first() }
  static async firstOrFail() { return this.query().firstOrFail() }

  static async find(id) {
    if (Array.isArray(id)) return this.query().whereIn(this.primaryKey, id).get()
    return this.query().where(this.primaryKey, id).first()
  }

  static async findOrFail(id) {
    const m = await this.find(id)
    if (!m) throw new ModelNotFoundException(`${this.name} [${id}] not found`)
    return m
  }

  static async findMany(ids) {
    return this.query().whereIn(this.primaryKey, ids).get()
  }

  static async count(col = '*') { return this.query().count(col) }
  static async max(col)          { return this.query().max(col) }
  static async min(col)          { return this.query().min(col) }
  static async sum(col)          { return this.query().sum(col) }
  static async avg(col)          { return this.query().avg(col) }
  static async exists()          { return this.query().exists() }
  static async doesntExist()     { return this.query().doesntExist() }

  static async pluck(col, key)   { return this.query().pluck(col, key) }
  static async value(col)        { return this.query().value(col) }
  static async chunk(n, fn)      { return this.query().chunk(n, fn) }
  static async paginate(p, pp)   { return this.query().paginate(p, pp) }

  static async create(attributes = {}) {
    const model = new this()
    model._fillRaw(attributes)
    await model.save()
    return model
  }

  static async insert(rows) {
    // Bulk insert without model hydration — returns raw result
    return this.getResolver().insert(this.getTable(), rows)
  }

  static async updateOrCreate(conditions, values = {}) {
    let model = await this.where(conditions).first()
    if (model) {
      await model.update(values)
    } else {
      model = await this.create({ ...conditions, ...values })
    }
    return model
  }

  static async firstOrCreate(conditions, values = {}) {
    return (await this.where(conditions).first()) ?? this.create({ ...conditions, ...values })
  }

  static async firstOrNew(conditions, values = {}) {
    const found = await this.where(conditions).first()
    if (found) return found
    const m = new this()
    m._fillRaw({ ...conditions, ...values })
    return m
  }

  static async truncate() {
    return this.getResolver().truncate(this.getTable())
  }

  // ─── Mass assignment ──────────────────────────────────────────────────────
  fill(attributes = {}) {
    const Klass = this.constructor
    const keys  = Object.keys(attributes)

    let allowed
    if (Klass.guarded.includes('*')) {
      // Fully guarded — nothing is fillable unless fillable explicitly set
      allowed = Klass.fillable.length > 0 ? keys.filter(k => Klass.fillable.includes(k)) : []
    } else if (Klass.fillable.length > 0) {
      // Whitelist mode
      allowed = keys.filter(k => Klass.fillable.includes(k))
    } else {
      // Blacklist mode
      allowed = keys.filter(k => !Klass.guarded.includes(k))
    }

    for (const k of allowed) this.setAttribute(k, attributes[k])
    return this
  }

  /** Fill ignoring guarded/fillable — for internal use and _hydrate. */
  forceFill(attributes = {}) {
    for (const [k, v] of Object.entries(attributes)) this.setAttribute(k, v)
    return this
  }

  /** Raw fill that bypasses mutators — used only during construction. */
  _fillRaw(attributes = {}) {
    const Klass = this.constructor
    const keys  = Object.keys(attributes)
    let allowed

    if (Klass.guarded.includes('*')) {
      allowed = Klass.fillable.length > 0 ? keys.filter(k => Klass.fillable.includes(k)) : []
    } else if (Klass.fillable.length > 0) {
      allowed = keys.filter(k => Klass.fillable.includes(k))
    } else {
      allowed = keys.filter(k => !Klass.guarded.includes(k))
    }

    for (const k of allowed) _attrs.get(raw(this))[k] = attributes[k]
  }

  // ─── Attribute get / set ──────────────────────────────────────────────────
  setAttribute(key, value) {
    const Klass   = this.constructor
    const mutator = `set${toPascalCase(key)}Attribute`

    if (typeof this[mutator] === 'function') {
      _attrs.get(raw(this))[key] = this[mutator](value)
    } else if (Klass.casts[key]) {
      _attrs.get(raw(this))[key] = CastRegistry.set(Klass.casts[key], value)
    } else {
      _attrs.get(raw(this))[key] = value
    }
    return this
  }

  getAttribute(key) {
    const Klass    = this.constructor
    const accessor = `get${toPascalCase(key)}Attribute`
    const rawVal = _attrs.get(raw(this))[key]

    if (typeof this[accessor] === 'function') {
      return this[accessor](rawVal)
    }
    return Klass.casts[key] ? CastRegistry.get(Klass.casts[key], rawVal) : rawVal
  }

  getAttributes()  { return { ..._attrs.get(raw(this)) } }
  getRawAttribute(key) { return _attrs.get(raw(this))[key] }

  getOriginal(key = null) {
    return key ? _original.get(raw(this))[key] : { ..._original.get(raw(this)) }
  }

  getDirty() {
    return Object.keys(_attrs.get(raw(this))).filter(k => {
      const orig = _original.get(raw(this))[k]
      const curr = _attrs.get(raw(this))[k]
      // Loose comparison to handle Date vs ISO string
      if (orig instanceof Date && curr instanceof Date)
        return orig.getTime() !== curr.getTime()
      return orig !== curr
    })
  }

  isDirty(key = null) {
    if (key) return _attrs.get(raw(this))[key] !== _original.get(raw(this))[key]
    return this.getDirty().length > 0
  }

  isClean(key = null) { return !this.isDirty(key) }
  wasChanged(key)     { return this.isDirty(key) }
  existsInDb()        { return _exists.get(raw(this)) }

  // ─── Persist ──────────────────────────────────────────────────────────────
  async save() {
    const Klass  = this.constructor
    const hooks  = HookRegistry.for(Klass)
    const now    = new Date()

    if (_exists.get(raw(this))) {
      // ─ UPDATE path ─────────────────────────────────────────────────────────
      await hooks.fire('updating', this)
      await EventEmitter.emit(`${Klass.name}:updating`, this)

      if (Klass.timestamps) _attrs.get(raw(this))[Klass.updatedAtColumn] = now

      const dirty = this.getDirty()
      if (dirty.length > 0) {
        const data = Object.fromEntries(dirty.map(k => [k, _attrs.get(raw(this))[k]]))
        await Klass.getResolver().update(
          Klass.getTable(),
          { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] },
          data
        )
        this._syncOriginal()
      }

      await hooks.fire('updated', this)
      await EventEmitter.emit(`${Klass.name}:updated`, this)

    } else {
      // ─ INSERT path ─────────────────────────────────────────────────────────
      await hooks.fire('creating', this)
      await EventEmitter.emit(`${Klass.name}:creating`, this)

      if (Klass.timestamps) {
        _attrs.get(raw(this))[Klass.createdAtColumn] = now
        _attrs.get(raw(this))[Klass.updatedAtColumn] = now
      }

      if (!_attrs.get(raw(this))[Klass.primaryKey]) {
        if (Klass.keyType === 'uuid') {
          _attrs.get(raw(this))[Klass.primaryKey] = randomUUID()
        }
      }

      const result = await Klass.getResolver().insert(Klass.getTable(), _attrs.get(raw(this)))

      // Driver returns inserted row (pg RETURNING *) or { insertedId } (mongo)
      if (result) {
        if (result[Klass.primaryKey] !== undefined) {
          _attrs.get(raw(this))[Klass.primaryKey] = result[Klass.primaryKey]
        } else if (result.insertedId !== undefined) {
          _attrs.get(raw(this))[Klass.primaryKey] = result.insertedId.toString()
        }
        // Merge any driver-generated defaults back into attrs
        for (const [k, v] of Object.entries(result)) {
          if (_attrs.get(raw(this))[k] === undefined) _attrs.get(raw(this))[k] = v
        }
      }

      _exists.set(raw(this), true)
      this._syncOriginal()

      await hooks.fire('created', this)
      await EventEmitter.emit(`${Klass.name}:created`, this)
    }

    return this
  }

  async update(attributes = {}) {
    this.fill(attributes)
    return this.save()
  }

  async delete() {
    const Klass = this.constructor
    const hooks = HookRegistry.for(Klass)

    await hooks.fire('deleting', this)
    await EventEmitter.emit(`${Klass.name}:deleting`, this)

    if (Klass.softDeletes) {
      // Soft delete: set deleted_at, skip deleting/deleted hooks in save()
      _attrs.get(raw(this))[Klass.deletedAtColumn] = new Date()
      if (Klass.timestamps) _attrs.get(raw(this))[Klass.updatedAtColumn] = new Date()

      await Klass.getResolver().update(
        Klass.getTable(),
        { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] },
        {
          [Klass.deletedAtColumn]: _attrs.get(raw(this))[Klass.deletedAtColumn],
          ...(Klass.timestamps ? { [Klass.updatedAtColumn]: _attrs.get(raw(this))[Klass.updatedAtColumn] } : {}),
        }
      )
      _trashed.set(raw(this), true)
      this._syncOriginal()
    } else {
      await Klass.getResolver().delete(
        Klass.getTable(),
        { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] }
      )
      _exists.set(raw(this), false)
    }

    await hooks.fire('deleted', this)
    await EventEmitter.emit(`${Klass.name}:deleted`, this)
  }

  async forceDelete() {
    const Klass = this.constructor
    const hooks = HookRegistry.for(Klass)

    await hooks.fire('deleting', this)
    await EventEmitter.emit(`${Klass.name}:deleting`, this)

    await Klass.getResolver().delete(
      Klass.getTable(),
      { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] }
    )
    _exists.get(raw(this))  = false
    _trashed.set(raw(this), false)

    await hooks.fire('deleted', this)
    await EventEmitter.emit(`${Klass.name}:deleted`, this)
  }

  async restore() {
    const Klass = this.constructor
    if (!Klass.softDeletes) return this

    const hooks = HookRegistry.for(Klass)
    await hooks.fire('restoring', this)
    await EventEmitter.emit(`${Klass.name}:restoring`, this)

    _attrs.get(raw(this))[Klass.deletedAtColumn] = null
    _trashed.set(raw(this), false)

    await Klass.getResolver().update(
      Klass.getTable(),
      { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] },
      { [Klass.deletedAtColumn]: null }
    )
    this._syncOriginal()

    await hooks.fire('restored', this)
    await EventEmitter.emit(`${Klass.name}:restored`, this)

    return this
  }

  async refresh() {
    const Klass = this.constructor
    const fresh = await Klass.withTrashed().where(Klass.primaryKey, _attrs.get(raw(this))[Klass.primaryKey]).first()
    if (fresh) {
      // Copy attrs from fresh instance — both are same class so private access is allowed
      _attrs.set(raw(this), { ..._attrs.get(raw(fresh)) })
      _trashed.set(raw(this), _trashed.get(raw(fresh)))
      this._syncOriginal()
    }
    return this
  }

  async fresh(withs = []) {
    const Klass = this.constructor
    let qb = Klass.withTrashed().where(Klass.primaryKey, _attrs.get(raw(this))[Klass.primaryKey])
    if (withs.length) qb = qb.with(...withs)
    return qb.first()
  }

  isTrashed()      { return _trashed.get(raw(this)) }
  isNew()          { return !_exists.get(raw(this)) }

  // ─── Relations ────────────────────────────────────────────────────────────
  hasOne(Related, foreignKey, localKey) {
    return RelationRegistry.hasOne(this, Related, foreignKey, localKey)
  }
  hasMany(Related, foreignKey, localKey) {
    return RelationRegistry.hasMany(this, Related, foreignKey, localKey)
  }
  belongsTo(Related, foreignKey, ownerKey) {
    return RelationRegistry.belongsTo(this, Related, foreignKey, ownerKey)
  }
  belongsToMany(Related, pivotTable, foreignKey, relatedKey) {
    return RelationRegistry.belongsToMany(this, Related, pivotTable, foreignKey, relatedKey)
  }
  hasManyThrough(Related, Through, firstKey, secondKey) {
    return RelationRegistry.hasManyThrough(this, Related, Through, firstKey, secondKey)
  }
  morphTo(name) {
    return RelationRegistry.morphTo(this, name)
  }
  morphMany(Related, name) {
    return RelationRegistry.morphMany(this, Related, name)
  }
  morphOne(Related, name) {
    return RelationRegistry.morphOne(this, Related, name)
  }

  setRelation(name, value) { _rels.get(raw(this))[name] = value; return this }
  getRelation(name)        { return _rels.get(raw(this))[name] }
  unsetRelation(name)      { delete _rels.get(raw(this))[name]; return this }
  relationLoaded(name)     { return Object.prototype.hasOwnProperty.call(_rels.get(raw(this)), name) }
  getRelations()           { return { ..._rels.get(raw(this)) } }

  // ─── Serialization ────────────────────────────────────────────────────────
  toJSON() {
    const Klass = this.constructor
    const out   = {}

    for (const [key, rawVal] of Object.entries(_attrs.get(raw(this)))) {
      if (Klass.hidden.includes(key)) continue
      if (Klass.visible.length > 0 && !Klass.visible.includes(key)) continue
      out[key] = CastRegistry.serialize(Klass.casts[key], rawVal)
    }

    // Appended virtual attributes
    for (const key of Klass.appends) {
      const accessor = `get${toPascalCase(key)}Attribute`
      if (typeof this[accessor] === 'function') out[key] = this[accessor]()
    }

    // Loaded relations
    for (const [key, value] of Object.entries(_rels.get(raw(this)))) {
      if (Array.isArray(value) || value instanceof Collection) {
        out[key] = value.map(v => v?.toJSON?.() ?? v)
      } else {
        out[key] = value?.toJSON?.() ?? value
      }
    }

    return out
  }

  toString() { return JSON.stringify(this.toJSON()) }

  // ─── Internal: used by _hydrate and refresh() ─────────────────────────────
  _syncOriginal() {
    _original.set(raw(this), { ..._attrs.get(raw(this)) })
  }

  /**
   * Reconstruct a model from a raw database row.
   * This is the ONLY way rows become Model instances.
   * Called from QueryBuilder.get() / first().
   */
  static _hydrate(row = {}) {
    // new this() → proxy; proxy[SELF] → raw instance (set in constructor)
    const proxy = new this()
    const inst  = proxy[SELF]  // the raw (un-proxied) instance

    // Bypass fill guards — we trust data from DB
    // Clear any attrs set by the empty constructor call
    _attrs.set(inst, {})
    for (const [k, v] of Object.entries(row)) {
      _attrs.get(inst)[k] = v
    }
    _exists.set(inst, true)
    inst._syncOriginal()
    if (this.softDeletes && row[this.deletedAtColumn] != null) {
      _trashed.set(inst, true)
    }
    return proxy
  }
}

// ─── Proxy handler for Model instances ───────────────────────────────────────
// Intercepts property access so `user.name` reads from the WeakMap state.
// Uses `raw(target)` to look up by the raw instance key.
// Helper: walk the prototype chain to find a property descriptor.
// Returns null if not found.
function findDescriptor(obj, prop) {
  let proto = Object.getPrototypeOf(obj)
  while (proto && proto !== Object.prototype) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)
    if (desc) return desc
    proto = Object.getPrototypeOf(proto)
  }
  // Also check the object's own properties (e.g. static-assigned props)
  const own = Object.getOwnPropertyDescriptor(obj, prop)
  if (own) return own
  return null
}

// a delegation pattern: call getAttribute/setAttribute on the target.

const SKIP_PROXY = new Set([
  // JS engine internals + serialization
  'then', 'catch', 'finally',
  Symbol.toPrimitive, Symbol.toStringTag, Symbol.iterator,
  Symbol.hasInstance, Symbol.isConcatSpreadable,
  // Node inspect
  'inspect', 'constructor',
  // Commonly checked
  'length', 'prototype',
])

const modelProxyHandler = {
  get(target, prop, receiver) {
    // Pass-through symbols (including SELF) and skip-list
    if (typeof prop === 'symbol') {
      // Allow SELF to be read/written directly on the proxy object
      if (prop === SELF) return target[SELF]
      return Reflect.get(target, prop, receiver)
    }
    if (SKIP_PROXY.has(prop)) {
      return Reflect.get(target, prop, receiver)
    }

    // Direct property on the target instance
    // Use receiver so methods keep `this = proxy` (for re-entrant attribute reads),
    // but we resolve the function FROM the target's prototype chain.
    const ownDescriptor = findDescriptor(target, prop)
    if (ownDescriptor) {
      if (typeof ownDescriptor.value === 'function') {
        // Return the function bound to receiver (the proxy) so `this.x` reads attrs
        return ownDescriptor.value.bind(receiver)
      }
      if (ownDescriptor.get) {
        return ownDescriptor.get.call(receiver)
      }
      if (ownDescriptor.value !== undefined) {
        return ownDescriptor.value
      }
    }

    // Relation that was eager-loaded
    if (target.relationLoaded(prop)) return target.getRelation(prop)

    // Dynamic attribute read — check WeakMap state via raw(target)
    const rawAttr = target.getRawAttribute(prop)
    if (rawAttr !== undefined) return target.getAttribute(prop)

    // Virtual attribute: an accessor method exists (getXxxAttribute)
    const toPascal = s => s.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase())
    const accessor = `get${toPascal(prop)}Attribute`
    const accFn = findDescriptor(target, accessor)
    if (accFn && typeof accFn.value === 'function') {
      // Call with receiver so `this.name` reads through proxy
      return accFn.value.call(receiver)
    }

    return undefined
  },

  set(target, prop, value, receiver) {
    if (typeof prop === 'symbol') {
      // Store symbol-keyed props (like SELF) directly on the target object
      target[prop] = value
      return true
    }
    if (SKIP_PROXY.has(prop)) {
      target[prop] = value
      return true
    }
    target.setAttribute(prop, value)
    return true
  },

  has(target, prop) {
    if (Reflect.has(target, prop)) return true
    if (target.relationLoaded(prop)) return true
    return target.getRawAttribute(prop) !== undefined
  },
}

// ─── withScopes() ─────────────────────────────────────────────────────────────
// Wraps a Model subclass in a Proxy so scopeActive() is callable as .active().
// Usage: export default withScopes(User)
//        const ScopedUser = withScopes(User)
export function withScopes(ModelClass) {
  return new Proxy(ModelClass, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver)
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'string') {
        const scopeMethod = `scope${prop[0].toUpperCase()}${prop.slice(1)}`
        if (typeof target[scopeMethod] === 'function') {
          return (...args) => {
            const qb = target.query()
            target[scopeMethod](qb, ...args)
            return qb
          }
        }
      }
      return undefined
    },
  })
}
