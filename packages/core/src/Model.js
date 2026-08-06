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
 *     // Local scopes — accessed via User.scope('active') or withScopes(User).active()
 *     static scopeActive(qb)       { return qb.where('active', true) }
 *     static scopeOlderThan(qb, n) { return qb.where('age', '>', n) }
 *
 *     // Lifecycle hooks
 *     static async creating(user) { user.slug = slugify(user.name) }
 *     static async created(user)  { await sendWelcome(user) }
 *   }
 */

import { randomUUID } from 'crypto'
import { QueryBuilder } from './QueryBuilder.js'
import { Collection } from './Collection.js'
import { HookRegistry } from './HookRegistry.js'
import { CastRegistry } from './CastRegistry.js'
import { getResolver } from './ConnectionRegistry.js'
import { ModelNotFoundException, MassAssignmentException } from './errors.js'
import { RelationRegistry } from './relations/RelationRegistry.js'
import { toSnakePlural, toPascalCase } from './utils.js'

// ─── Private state via WeakMap ───────────────────────────────────────────────
// Using WeakMap keyed on the RAW instance (not the proxy).
// The SELF symbol on each proxy points back to the raw instance,
// so all WeakMap lookups use the raw key regardless of proxy/target.
const _attrs = new WeakMap()
const _original = new WeakMap()
const _rels = new WeakMap()
const _exists = new WeakMap()
const _trashed = new WeakMap()
const _changes = new WeakMap()   // what the last save() actually wrote — wasChanged()
const SELF = Symbol('self')  // proxy[SELF] → raw instance

// Classes with mass assignment disabled. Per-class, inherited down the chain:
// Model.unguard() unguards everything, User.unguard() only User.
const _unguardedClasses = new WeakSet()

// Get the raw (non-proxy) instance for WeakMap keying.
// Works whether `obj` is the proxy or the raw instance.
function raw(obj) { return obj[SELF] ?? obj }

/**
 * The Resolver Contract — see packages/core/RESOLVER.md, and the machine-checked
 * version in core/src/testing/conformance.js. Those three are kept in step.
 *
 * A driver (mongodb, pgsql, sqlite, ...) implements this to plug into
 * Model/QueryBuilder. Only `select`, `insert`, `update`, `delete` and `truncate`
 * are required; everything marked optional below is guarded at the call site and
 * raises a clear error naming the driver when absent.
 *
 * @typedef {Object} ModelResolver
 * @property {(table: string, ctx: any) => Promise<Record<string, any>[]>} select
 * @property {(table: string, data: Record<string, any>) => Promise<Record<string, any> & {insertedId?: any}>} insert
 * @property {(table: string, rows: Record<string, any>[]) => Promise<Record<string, any>[]>} [insertMany]
 * @property {(table: string, conditions: Record<string, any>, data: Record<string, any>, ctx?: any) => Promise<number>} update
 * @property {(table: string, conditions: Record<string, any>, ctx?: any) => Promise<number>} delete
 * @property {(table: string, opts?: {cascade?: boolean, restartIdentity?: boolean}) => Promise<void>} truncate
 * @property {(table: string, rows: Record<string, any>[], uniqueBy: string[], update: string[]|null) => Promise<number>} [upsert]
 * @property {(sql: string, params?: any[]) => Promise<any>} [raw]
 * @property {boolean} [supportsJoins] false when the store cannot JOIN (mongodb)
 * @property {(table: string, fn: 'count'|'sum'|'avg'|'min'|'max', column: string, ctx: any) => Promise<number>} [aggregate]
 * @property {(table: string, ctx: any) => Promise<{sql: string, params: any[]} | Record<string, any>>} [toSQL]
 * @property {(table: string, column: string, amount: number, extra: Record<string, any>, ctx: any) => Promise<number>} [increment]
 * @property {(opts: Record<string, any>) => Promise<Record<string, any>[]>} [selectPivot]
 * @property {(opts: Record<string, any>) => Promise<Record<string, any>[]>} [selectPivotMany]
 * @property {(opts: Record<string, any>) => Promise<Record<string, any>[]>} [hasManyThrough]
 * @property {(opts: Record<string, any>) => Promise<Record<string, any>[]>} [hasManyThroughMany]
 * @property {(table: string, blueprint: any) => Promise<void>} [createTable]
 * @property {(table: string, blueprint: any) => Promise<void>} [alterTable]
 * @property {(table: string, opts?: {ifExists?: boolean, cascade?: boolean}) => Promise<void>} [dropTable]
 * @property {(from: string, to: string) => Promise<void>} [renameTable]
 * @property {(table: string) => Promise<boolean>} [hasTable]
 * @property {(table: string, column: string) => Promise<boolean>} [hasColumn]
 * @property {(table: string) => Promise<string[]>} [getColumnListing]
 * @property {(fn: (tx: ModelResolver) => Promise<any>) => Promise<any>} [transaction]
 */

// ─── Attribute ───────────────────────────────────────────────────────────────
/**
 * A get/set pair for one attribute, declared in one place — Laravel 9's
 * `Attribute::make(get:, set:)`.
 *
 *   class User extends Model {
 *     get full_name() {
 *       return Attribute.make({
 *         get: (value, attrs) => `${attrs.first_name} ${attrs.last_name}`,
 *       })
 *     }
 *     get email() {
 *       return Attribute.make({ set: v => String(v).toLowerCase() })
 *     }
 *   }
 *
 * Declared as a **getter** (or an instance field), not a method: PHP can tell
 * `$user->email` from `$user->email()`, JS cannot, so a method named after the
 * attribute would shadow the attribute on every read. `set` may return an
 * object to write several columns at once.
 */
export class Attribute {
    /** @param {{get?: (value: any, attributes: Record<string, any>) => any, set?: (value: any, attributes: Record<string, any>) => any}} pair */
    constructor({ get, set } = {}) {
        this.get = get
        this.set = set
    }

    /** @param {{get?: (value: any, attributes: Record<string, any>) => any, set?: (value: any, attributes: Record<string, any>) => any}} pair */
    static make(pair = {}) { return new Attribute(pair) }
}

// ─── Model ───────────────────────────────────────────────────────────────────
export class Model {
    // ─── Subclass overrides ────────────────────────────────────────────────────
    /** @type {string | null} */
    static table = null      // defaults to snake_plural of class name
    static primaryKey = 'id'
    /** @type {'integer' | 'uuid'} */
    static keyType = 'integer'
    static incrementing = true

    /** @type {string[]} */
    static fillable = []        // [] means nothing is fillable unless guarded is []
    /**
     * Everything is guarded until you opt in with `fillable`, matching Laravel's
     * default. `[]` allows all keys (unsafe with untrusted input); a list guards
     * exactly those columns.
     * @type {string[]}
     */
    static guarded = ['*']

    /**
     * Throw MassAssignmentException instead of silently dropping keys that
     * fillable/guarded disallows. Off by default (Laravel's default too), but
     * worth enabling in development.
     */
    static strictFill = false

    /** @type {Record<string, string>} */
    static casts = {}
    /** @type {string[]} */
    static hidden = []
    /** @type {string[]} */
    static visible = []
    /** @type {string[]} */
    static appends = []

    static timestamps = true
    static createdAtColumn = 'created_at'
    static updatedAtColumn = 'updated_at'

    static softDeletes = false
    static deletedAtColumn = 'deleted_at'

    /** @type {Record<string, (qb: QueryBuilder) => void>} */
    static globalScopes = {}   // { name: qb => qb.where(...) }
    static connection = 'default'

    /**
     * Default attribute values for new instances. Functions are called per
     * instance, so `{ uuid: () => randomUUID() }` is safe.
     * @type {Record<string, any>}
     */
    static attributes = {}

    /**
     * Relations always eager-loaded — Laravel's `$with`. Named `withRelations`
     * because `static with()` is the query shorthand.
     * @type {string[]}
     */
    static withRelations = []

    /**
     * Relations whose parent is touched when this model is saved — `$touches`.
     * @type {string[]}
     */
    static touches = []

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

    /** @param {Record<string, any>} attributes */
    constructor(attributes = {}) {
        // Fill attributes BEFORE wrapping in Proxy
        _attrs.set(raw(this), {})
        _original.set(raw(this), {})
        _rels.set(raw(this), {})
        _exists.set(raw(this), false)
        _trashed.set(raw(this), false)
        _changes.set(raw(this), {})
        // Column defaults, like Laravel's $attributes
        for (const [k, v] of Object.entries(/** @type {typeof Model} */(this.constructor).attributes)) {
            _attrs.get(raw(this))[k] = typeof v === 'function' ? v() : v
        }
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

    /** @returns {ModelResolver} */
    static getResolver() {
        return getResolver(this.connection)
    }

    /**
     * Disable mass-assignment protection for this class and its subclasses.
     * ponytail: still shared state for the duration — in a request handler
     * prefer unguarded(cb), which always restores.
     */
    static unguard() {
        _unguardedClasses.add(this)
        return this
    }

    static reguard() {
        _unguardedClasses.delete(this)
        return this
    }

    static isUnguarded() {
        for (let k = this; k && k !== Function.prototype; k = Object.getPrototypeOf(k)) {
            if (_unguardedClasses.has(k)) return true
        }
        return false
    }

    static async unguarded(callback) {
        const wasUnguarded = _unguardedClasses.has(this)
        _unguardedClasses.add(this)
        try {
            return await callback()
        } finally {
            if (!wasUnguarded) _unguardedClasses.delete(this)
        }
    }

    // ─── Query builder factory ─────────────────────────────────────────────────
    /**
     * @template {typeof Model} T
     * @this {T}
     * @returns {QueryBuilder<T>}
     */
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

        // Default eager loads
        if (this.withRelations.length) qb.with(...this.withRelations)

        return qb
    }

    /**
     * Apply a named local scope: `User.scope('active')` runs `scopeActive(qb)`.
     * Extra arguments are forwarded — `User.scope('olderThan', 30)`.
     * @param {string} name
     * @param {...any} args
     * @returns {QueryBuilder}
     */
    static scope(name, ...args) {
        const method = `scope${toPascalCase(name)}`
        if (typeof this[method] !== 'function') {
            throw new Error(`[EloquentJS] ${this.name} has no scope "${name}" (expected static ${method}())`)
        }
        const qb = this.query()
        return this[method](qb, ...args) ?? qb
    }

    // ─── Scope proxy — makes User.active() work ────────────────────────────────
    // Returns a Proxy for the Model class itself. When a static property that
    // doesn't exist is accessed (e.g. .active), check for scopeActive method
    // and return a function that calls query().scopeActive().
    // ─── Static query shorthands ──────────────────────────────────────────────
    static where(...a) { return this.query().where(...a) }
    static orWhere(...a) { return this.query().orWhere(...a) }
    static whereIn(...a) { return this.query().whereIn(...a) }
    static whereNotIn(...a) { return this.query().whereNotIn(...a) }
    static whereNull(...a) { return this.query().whereNull(...a) }
    static whereNotNull(...a) { return this.query().whereNotNull(...a) }
    static whereNot(...a) { return this.query().whereNot(...a) }
    static whereBetween(...a) { return this.query().whereBetween(...a) }
    static whereNotBetween(...a) { return this.query().whereNotBetween(...a) }
    static whereRaw(...a) { return this.query().whereRaw(...a) }
    static whereLike(...a) { return this.query().whereLike(...a) }
    static whereNotLike(...a) { return this.query().whereNotLike(...a) }
    static whereDate(...a) { return this.query().whereDate(...a) }
    static whereYear(...a) { return this.query().whereYear(...a) }
    static whereMonth(...a) { return this.query().whereMonth(...a) }
    static whereDay(...a) { return this.query().whereDay(...a) }
    static whereJsonContains(...a) { return this.query().whereJsonContains(...a) }
    static whereTime(column, operator, value) { return this.query().whereTime(column, operator, value) }
    static whereColumn(first, operator, second) { return this.query().whereColumn(first, operator, second) }
    static whereExists(Related, cb) { return this.query().whereExists(Related, cb) }
    static whereNotExists(Related, cb) { return this.query().whereNotExists(Related, cb) }
    static whereHas(relation, cb) { return this.query().whereHas(relation, cb) }
    static orWhereHas(relation, cb) { return this.query().orWhereHas(relation, cb) }
    static whereDoesntHave(relation, cb) { return this.query().whereDoesntHave(relation, cb) }
    static has(relation, cb) { return this.query().has(relation, cb) }
    static doesntHave(relation, cb) { return this.query().doesntHave(relation, cb) }
    static withCount(...a) { return this.query().withCount(...a) }
    static withExists(...a) { return this.query().withExists(...a) }
    static withSum(...a) { return this.query().withSum(...a) }
    static when(...a) { return this.query().when(...a) }
    static unless(...a) { return this.query().unless(...a) }
    static select(...a) { return this.query().select(...a) }
    static selectRaw(...a) { return this.query().selectRaw(...a) }
    static orderByRaw(...a) { return this.query().orderByRaw(...a) }
    static havingRaw(...a) { return this.query().havingRaw(...a) }
    static groupByRaw(...a) { return this.query().groupByRaw(...a) }
    static lockForUpdate() { return this.query().lockForUpdate() }
    static sharedLock() { return this.query().sharedLock() }
    static addSelect(...a) { return this.query().addSelect(...a) }
    static orderBy(...a) { return this.query().orderBy(...a) }
    static orderByDesc(c) { return this.query().orderByDesc(c) }
    static inRandomOrder() { return this.query().inRandomOrder() }
    static latest(c) { return this.query().latest(c) }
    static oldest(c) { return this.query().oldest(c) }
    static limit(n) { return this.query().limit(n) }
    static take(n) { return this.query().take(n) }
    static offset(n) { return this.query().offset(n) }
    static skip(n) { return this.query().skip(n) }
    static forPage(...a) { return this.query().forPage(...a) }
    static with(...a) { return this.query().with(...a) }
    static join(...a) { return this.query().join(...a) }
    static leftJoin(...a) { return this.query().leftJoin(...a) }
    static rightJoin(...a) { return this.query().rightJoin(...a) }
    static crossJoin(...a) { return this.query().crossJoin(...a) }
    static groupBy(...a) { return this.query().groupBy(...a) }
    static having(...a) { return this.query().having(...a) }
    static distinct() { return this.query().distinct() }
    static withTrashed() { return this.query().withTrashed() }
    static onlyTrashed() { return this.query().onlyTrashed() }

    /** @template {typeof Model} T @this {T} @returns {Promise<Collection<InstanceType<T>>>} */
    static async all() { return this.query().get() }
    /** @template {typeof Model} T @this {T} @returns {Promise<Collection<InstanceType<T>>>} */
    static async get() { return this.query().get() }
    /** @template {typeof Model} T @this {T} @returns {Promise<InstanceType<T> | null>} */
    static async first() { return this.query().first() }
    /** @template {typeof Model} T @this {T} @returns {Promise<InstanceType<T>>} */
    static async firstOrFail() { return this.query().firstOrFail() }

    /**
     * @template {typeof Model} T
     * @this {T}
     * @param {string | number | (string | number)[]} id
     * @returns {Promise<InstanceType<T> | Collection<InstanceType<T>> | null>}
     */
    static async find(id) {
        if (Array.isArray(id)) return this.query().whereIn(this.primaryKey, id).get()
        return this.query().where(this.primaryKey, id).first()
    }

    /**
     * @template {typeof Model} T
     * @this {T}
     * @param {string | number} id
     * @returns {Promise<InstanceType<T>>}
     */
    static async findOrFail(id) {
        const m = await this.query().where(this.primaryKey, id).first()
        if (!m) throw new ModelNotFoundException(`${this.name} [${id}] not found`)
        return m
    }

    /**
     * @template {typeof Model} T
     * @this {T}
     * @param {(string | number)[]} ids
     * @returns {Promise<Collection<InstanceType<T>>>}
     */
    static async findMany(ids) {
        return this.query().whereIn(this.primaryKey, ids).get()
    }

    static async count(col = '*') { return this.query().count(col) }
    static async max(col) { return this.query().max(col) }
    static async min(col) { return this.query().min(col) }
    static async sum(col) { return this.query().sum(col) }
    static async avg(col) { return this.query().avg(col) }
    static async exists() { return this.query().exists() }
    static async doesntExist() { return this.query().doesntExist() }

    static async pluck(col, key) { return this.query().pluck(col, key) }
    static async value(col) { return this.query().value(col) }
    static async chunk(n, fn) { return this.query().chunk(n, fn) }
    static async chunkById(n, fn) { return this.query().chunkById(n, fn) }
    static async paginate(p, pp) { return this.query().paginate(p, pp) }
    static async simplePaginate(p, pp) { return this.query().simplePaginate(p, pp) }
    static async cursorPaginate(pp, cursor) { return this.query().cursorPaginate(pp, cursor) }
    static async sole() { return this.query().sole() }
    static async firstWhere(...a) { return this.query().where(...a).first() }
    static lazy(n) { return this.query().lazy(n) }
    static cursor() { return this.query().cursor() }

    /**
     * @template {typeof Model} T
     * @this {T}
     * @param {Record<string, any>} attributes
     * @returns {Promise<InstanceType<T>>}
     */
    static async create(attributes = {}) {
        const model = /** @type {InstanceType<T>} */ (new this())
        model._fillRaw(attributes)
        await model.save()
        return model
    }

    static async insert(rows) {
        // Bulk insert without model hydration — returns raw rows
        const resolver = this.getResolver()
        if (!Array.isArray(rows)) return resolver.insert(this.getTable(), rows)
        if (!rows.length) return []
        if (typeof resolver.insertMany !== 'function') {
            throw new Error(`${resolver.constructor.name} does not implement insertMany()`)
        }
        return resolver.insertMany(this.getTable(), rows)
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

    /**
     * The records eligible for pruning — Laravel's Prunable. Override to opt in:
     *
     *   static prunable() { return this.where('created_at', '<', cutoff) }
     *
     * @returns {QueryBuilder|null}
     */
    static prunable() { return null }

    /**
     * Delete everything `prunable()` matches, in chunks, firing `pruning` per
     * record. Soft-deleting models are force-deleted — pruning is meant to
     * reclaim the row, not to trash it again.
     * @param {{chunk?: number}} opts
     * @returns {Promise<number>} how many records were deleted
     */
    static async prune({ chunk = 1000 } = {}) {
        const qb = this.prunable()
        if (!qb) {
            throw new Error(`[EloquentJS] ${this.name} is not prunable — define static prunable().`)
        }
        const hooks = HookRegistry.for(this)
        let pruned = 0
        // chunkById, not chunk: the callback deletes the rows it was handed, and
        // OFFSET paging would skip a page's worth of records each round.
        await qb.chunkById(chunk, async models => {
            for (const model of models) {
                await hooks.fire('pruning', model)
                if (this.softDeletes) await model.forceDelete()
                else await model.delete()
                pruned++
            }
        })
        return pruned
    }

    static async truncate(opts = {}) {
        return this.getResolver().truncate(this.getTable(), opts)
    }

    /**
     * Insert rows, updating the ones that collide on `uniqueBy`.
     * @param {Record<string, any>[]} rows
     * @param {string|string[]} uniqueBy
     * @param {string[]} [update] columns to overwrite; defaults to all non-key columns
     */
    static async upsert(rows, uniqueBy, update = null) {
        return this.query().upsert(rows, uniqueBy, update)
    }

    static async updateOrInsert(conditions, values = {}) {
        return this.query().updateOrInsert(conditions, values)
    }

    /** Register an observer object — Model.observe(new UserObserver()). */
    static observe(observer) {
        HookRegistry.observe(this, observer)
        return this
    }

    /** Register a single lifecycle hook. Returns an unregister function. */
    static on(event, fn) {
        return HookRegistry.register(this, event, fn)
    }

    /** Run `callback` with timestamps disabled for this class. */
    static async withoutTimestamps(callback) {
        const previous = this.timestamps
        this.timestamps = false
        try { return await callback() } finally { this.timestamps = previous }
    }

    /** The column route parameters resolve against — override for slugs. */
    static getRouteKeyName() { return this.primaryKey }

    static async resolveRouteBinding(value, field = null) {
        return this.query().where(field ?? this.getRouteKeyName(), value).first()
    }

    static async increment(column, amount = 1, extra = {}) {
        return this.query().increment(column, amount, extra)
    }

    static async decrement(column, amount = 1, extra = {}) {
        return this.query().decrement(column, amount, extra)
    }

    // ─── Mass assignment ──────────────────────────────────────────────────────

    /**
     * Determine which keys from `attributes` are allowed through the
     * fillable / guarded configuration.  Single source of truth — used by
     * both fill() and _fillRaw() so the logic can never drift.
     */
    _getAllowedKeys(attributes) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const keys = Object.keys(attributes)

        if (Klass.isUnguarded()) {
            return keys
        }

        let allowed
        if (Klass.fillable.length > 0) {
            allowed = keys.filter(k => Klass.fillable.includes(k))
        } else if (Klass.guarded.includes('*')) {
            allowed = []
        } else {
            allowed = keys.filter(k => !Klass.guarded.includes(k))
        }

        if (Klass.strictFill && allowed.length !== keys.length) {
            const blocked = keys.filter(k => !allowed.includes(k))
            throw new MassAssignmentException(
                `Add [${blocked.join(', ')}] to ${Klass.name}'s fillable to allow mass assignment.`
            )
        }
        return allowed
    }

    fill(attributes = {}) {
        for (const k of this._getAllowedKeys(attributes)) this.setAttribute(k, attributes[k])
        return this
    }

    /** Fill ignoring guarded/fillable — for internal use and _hydrate. */
    forceFill(attributes = {}) {
        for (const [k, v] of Object.entries(attributes)) this.setAttribute(k, v)
        return this
    }

    /** Raw fill that bypasses mutators — used only during construction. */
    _fillRaw(attributes = {}) {
        for (const k of this._getAllowedKeys(attributes)) _attrs.get(raw(this))[k] = attributes[k]
    }

    // ─── Attribute get / set ──────────────────────────────────────────────────
    /**
     * The `Attribute` object declared for `key`, if the class declares one.
     * Looked up on the raw instance so the Proxy cannot turn the getter's
     * result into an attribute read, and never invokes a plain method — a
     * function descriptor is not an Attribute.
     * @param {string} key
     * @returns {Attribute|null}
     */
    _attributeObject(key) {
        const desc = findDescriptor(raw(this), key)
        if (!desc) return null
        const value = desc.get ? desc.get.call(this) : desc.value
        return value instanceof Attribute ? value : null
    }

    setAttribute(key, value) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const mutator = `set${toPascalCase(key)}Attribute`

        const attr = this._attributeObject(key)
        if (attr?.set) {
            const out = attr.set(value, this.getAttributes())
            // Returning an object writes several columns at once, as Laravel's
            // array return does.
            if (out !== null && typeof out === 'object' && !(out instanceof Date) && !Array.isArray(out)) {
                Object.assign(_attrs.get(raw(this)), out)
            } else {
                _attrs.get(raw(this))[key] = out
            }
            return this
        }

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
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const accessor = `get${toPascalCase(key)}Attribute`
        const rawVal = _attrs.get(raw(this))[key]

        const attr = this._attributeObject(key)
        if (attr?.get) return attr.get(rawVal, this.getAttributes())

        if (typeof this[accessor] === 'function') {
            return this[accessor](rawVal)
        }
        return Klass.casts[key] ? CastRegistry.get(Klass.casts[key], rawVal) : rawVal
    }

    getAttributes() { return { ..._attrs.get(raw(this)) } }
    getRawAttribute(key) { return _attrs.get(raw(this))[key] }
    unsetAttribute(key) { delete _attrs.get(raw(this))[key]; return this }

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

    /**
     * Did the last save() actually write this attribute? (Eloquent semantics.)
     * `isDirty()` answers the different question of pending changes.
     * @param {string} [key]
     */
    wasChanged(key = null) {
        const changes = _changes.get(raw(this)) ?? {}
        return key ? Object.prototype.hasOwnProperty.call(changes, key) : Object.keys(changes).length > 0
    }

    /** The attributes written by the last save(), old → new. */
    getChanges() { return { ...(_changes.get(raw(this)) ?? {}) } }

    existsInDb() { return _exists.get(raw(this)) }

    /** Is this the same DB record as `other`? */
    is(other) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        return !!other
            && other.constructor === Klass
            && String(this.getRawAttribute(Klass.primaryKey)) === String(other.getRawAttribute(Klass.primaryKey))
    }

    isNot(other) { return !this.is(other) }

    /** An unsaved copy without the primary key or timestamps. */
    replicate(except = []) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const skip = new Set([
            Klass.primaryKey, Klass.createdAtColumn, Klass.updatedAtColumn,
            Klass.deletedAtColumn, ...except,
        ])
        const clone = new Klass()
        for (const [k, v] of Object.entries(_attrs.get(raw(this)))) {
            if (!skip.has(k)) _attrs.get(raw(clone))[k] = v
        }
        return clone
    }

    // ─── Persist ──────────────────────────────────────────────────────────────
    /**
     * Insert or update. Returns `this`; returns without writing when a
     * `saving`/`creating`/`updating` hook returns false.
     */
    async save({ timestamps = true } = {}) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const hooks = HookRegistry.for(Klass)
        const attrs = _attrs.get(raw(this))
        const useTimestamps = Klass.timestamps && timestamps !== false
        const now = new Date()

        if (await hooks.fire('saving', this) === false) return this

        if (_exists.get(raw(this))) {
            // ─ UPDATE path ─────────────────────────────────────────────────────────
            // Dirtiness is computed BEFORE touching updated_at, otherwise every
            // save() would look dirty and issue a pointless UPDATE.
            if (!this.getDirty().length) {
                _changes.set(raw(this), {})
                return this
            }

            if (await hooks.fire('updating', this) === false) return this

            if (useTimestamps) attrs[Klass.updatedAtColumn] = now

            const dirty = this.getDirty()
            const data = Object.fromEntries(dirty.map(k => [k, attrs[k]]))
            await Klass.getResolver().update(
                Klass.getTable(),
                { [Klass.primaryKey]: attrs[Klass.primaryKey] },
                data
            )
            this._recordChanges(dirty)
            this._syncOriginal()

            await hooks.fire('updated', this)

        } else {
            // ─ INSERT path ─────────────────────────────────────────────────────────
            if (await hooks.fire('creating', this) === false) return this

            if (useTimestamps) {
                attrs[Klass.createdAtColumn] = now
                attrs[Klass.updatedAtColumn] = now
            }

            if (!attrs[Klass.primaryKey] && Klass.keyType === 'uuid') {
                attrs[Klass.primaryKey] = randomUUID()
            }

            const result = await Klass.getResolver().insert(Klass.getTable(), attrs)

            // Driver returns inserted row (pg RETURNING *) or { insertedId } (mongo)
            if (result) {
                if (result[Klass.primaryKey] !== undefined) {
                    attrs[Klass.primaryKey] = result[Klass.primaryKey]
                } else if (result.insertedId !== undefined) {
                    attrs[Klass.primaryKey] = result.insertedId.toString()
                }
                // Merge any driver-generated defaults back into attrs
                for (const [k, v] of Object.entries(result)) {
                    if (attrs[k] === undefined) attrs[k] = v
                }
            }

            _exists.set(raw(this), true)
            this._recordChanges(Object.keys(attrs))
            this._syncOriginal()

            await hooks.fire('created', this)
        }

        await hooks.fire('saved', this)
        await this._touchOwners()
        return this
    }

    /** Save without updating timestamps — Laravel's withoutTimestamps(). */
    async saveQuietly() { return this.save({ timestamps: false }) }

    _recordChanges(keys) {
        const attrs = _attrs.get(raw(this))
        const original = _original.get(raw(this))
        _changes.set(raw(this), Object.fromEntries(keys.map(k => [k, { from: original[k], to: attrs[k] }])))
    }

    /** Bump updated_at on the relations listed in `static touches`. */
    async _touchOwners() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        for (const name of Klass.touches) {
            const rel = typeof this[name] === 'function' ? this[name]() : null
            const owner = await rel?.get?.()
            for (const model of [owner].flat().filter(Boolean)) await model.touch()
        }
    }

    /** Set updated_at to now and save. */
    async touch() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        if (!Klass.timestamps) return this
        _attrs.get(raw(this))[Klass.updatedAtColumn] = new Date()
        return this.save()
    }

    async update(attributes = {}) {
        this.fill(attributes)
        return this.save()
    }

    /** Save this model and every loaded relation below it — Eloquent's push(). */
    async push() {
        await this.save()
        for (const value of Object.values(_rels.get(raw(this)))) {
            for (const model of [value].flat().filter(Boolean)) {
                if (typeof model?.push === 'function') await model.push()
            }
        }
        return this
    }

    async delete() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const hooks = HookRegistry.for(Klass)

        if (await hooks.fire('deleting', this) === false) return

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
    }

    async forceDelete() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const hooks = HookRegistry.for(Klass)

        if (await hooks.fire('forceDeleting', this) === false) return
        if (await hooks.fire('deleting', this) === false) return

        await Klass.getResolver().delete(
            Klass.getTable(),
            { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] }
        )
        _exists.set(raw(this), false)
        _trashed.set(raw(this), false)

        await hooks.fire('deleted', this)
        await hooks.fire('forceDeleted', this)
    }

    async restore() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        if (!Klass.softDeletes) return this

        const hooks = HookRegistry.for(Klass)
        if (await hooks.fire('restoring', this) === false) return this

        _attrs.get(raw(this))[Klass.deletedAtColumn] = null
        _trashed.set(raw(this), false)

        await Klass.getResolver().update(
            Klass.getTable(),
            { [Klass.primaryKey]: _attrs.get(raw(this))[Klass.primaryKey] },
            { [Klass.deletedAtColumn]: null }
        )
        this._syncOriginal()

        await hooks.fire('restored', this)

        return this
    }

    async refresh() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
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
        const Klass = /** @type {typeof Model} */ (this.constructor)
        let qb = Klass.withTrashed().where(Klass.primaryKey, _attrs.get(raw(this))[Klass.primaryKey])
        if (withs.length) qb = qb.with(...withs)
        return qb.first()
    }

    isTrashed() { return _trashed.get(raw(this)) }
    isNew() { return !_exists.get(raw(this)) }

    // ─── Relations ────────────────────────────────────────────────────────────
    hasOne(Related, foreignKey, localKey) {
        return RelationRegistry.hasOne(this, Related, foreignKey, localKey)
    }
    /**
     * The one related row that wins on `column` — `latestOfMany()` in short form.
     *   latestPost() { return this.hasOneOfMany(Post) }
     *   firstPost()  { return this.hasOneOfMany(Post, 'created_at', 'MIN') }
     */
    hasOneOfMany(Related, column, aggregate, foreignKey, localKey) {
        return RelationRegistry.hasOneOfMany(this, Related, column, aggregate, foreignKey, localKey)
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
    hasManyThrough(Related, Through, firstKey, secondKey, localKey, throughKey) {
        return RelationRegistry.hasManyThrough(this, Related, Through, firstKey, secondKey, localKey, throughKey)
    }
    hasOneThrough(Related, Through, firstKey, secondKey, localKey, throughKey) {
        return RelationRegistry.hasOneThrough(this, Related, Through, firstKey, secondKey, localKey, throughKey)
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
    morphToMany(Related, name, pivotTable, relatedKey) {
        return RelationRegistry.morphToMany(this, Related, name, pivotTable, relatedKey)
    }
    morphedByMany(Related, name, pivotTable, relatedKey) {
        return RelationRegistry.morphedByMany(this, Related, name, pivotTable, relatedKey)
    }

    /**
     * Store a withCount()/withSum() result. Written straight to the attribute
     * bag *and* to `_original`, so it never shows up as a dirty column.
     */
    setRelationAggregate(alias, value) {
        _attrs.get(raw(this))[alias] = value
        _original.get(raw(this))[alias] = value
        return this
    }

    setRelation(name, value) { _rels.get(raw(this))[name] = value; return this }
    getRelation(name) { return _rels.get(raw(this))[name] }
    unsetRelation(name) { delete _rels.get(raw(this))[name]; return this }
    relationLoaded(name) { return Object.prototype.hasOwnProperty.call(_rels.get(raw(this)), name) }
    getRelations() { return { ..._rels.get(raw(this)) } }

    // ─── Serialization ────────────────────────────────────────────────────────
    /**
     * Whether a key survives the hidden/visible filters. `visible` wins when
     * both name the same key, matching Eloquent — and it applies to appended
     * attributes and relations too, not only real columns.
     * @param {string} key
     */
    _isVisible(key) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        if (Klass.visible.length > 0) return Klass.visible.includes(key)
        return !Klass.hidden.includes(key)
    }

    toJSON() {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        const out = {}

        for (const [key, rawVal] of Object.entries(_attrs.get(raw(this)))) {
            if (!this._isVisible(key)) continue
            // An accessor overrides the stored value, as it does on read.
            const accessor = `get${toPascalCase(key)}Attribute`
            if (this._attributeObject(key)?.get) out[key] = this.getAttribute(key)
            else if (typeof this[accessor] === 'function') out[key] = this[accessor](rawVal)
            else out[key] = CastRegistry.serialize(Klass.casts[key], rawVal)
        }

        // Appended virtual attributes
        for (const key of Klass.appends) {
            if (!this._isVisible(key)) continue
            const accessor = `get${toPascalCase(key)}Attribute`
            if (this._attributeObject(key)?.get) out[key] = this.getAttribute(key)
            else if (typeof this[accessor] === 'function') out[key] = this[accessor]()
        }

        // Loaded relations
        for (const [key, value] of Object.entries(_rels.get(raw(this)))) {
            if (!this._isVisible(key)) continue
            if (Array.isArray(value) || value instanceof Collection) {
                out[key] = value.map(v => v?.toJSON?.() ?? v)
            } else {
                out[key] = value?.toJSON?.() ?? value
            }
        }

        return out
    }

    toString() { return JSON.stringify(this.toJSON()) }

    /** Eager-load relations onto an already-fetched model. */
    async load(...relations) {
        const Klass = /** @type {typeof Model} */ (this.constructor)
        await Klass.query()._eagerLoad([this], relations.flat())
        return this
    }

    /** Like load(), but skips relations that are already loaded. */
    async loadMissing(...relations) {
        const missing = relations.flat().filter(r => !this.relationLoaded(String(r).split('.')[0]))
        return missing.length ? this.load(missing) : this
    }

    // ─── Internal: used by _hydrate and refresh() ─────────────────────────────
    _syncOriginal() {
        _original.set(raw(this), { ..._attrs.get(raw(this)) })
    }

    /**
     * Reconstruct a model from a raw database row.
     * This is the ONLY way rows become Model instances.
     * Called from QueryBuilder.get() / first().
     */
    /**
     * @template {typeof Model} T
     * @this {T}
     * @param {Record<string, any>} row
     * @returns {InstanceType<T>}
     */
    static _hydrate(row = {}) {
        // new this() → proxy; proxy[SELF] → raw instance (set in constructor)
        const proxy = new this()
        const inst = proxy[SELF]  // the raw (un-proxied) instance

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
        return /** @type {InstanceType<T>} */ (proxy)
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

        // Relation that was eager-loaded
        if (target.relationLoaded(prop)) return target.getRelation(prop)

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
                const value = ownDescriptor.get.call(receiver)
                // `get full_name() { return Attribute.make(...) }` declares an
                // accessor, so the read resolves it rather than handing back the
                // Attribute object itself.
                return value instanceof Attribute ? target.getAttribute(prop) : value
            }
            if (ownDescriptor.value instanceof Attribute) {
                return target.getAttribute(prop)
            }
            if (ownDescriptor.value !== undefined) {
                return ownDescriptor.value
            }
        }

        // Dynamic attribute read — check WeakMap state via raw(target)
        const rawAttr = target.getRawAttribute(prop)
        if (rawAttr !== undefined) return target.getAttribute(prop)

        // Virtual attribute: an accessor method exists (getXxxAttribute).
        // Must use the shared toPascalCase, or Proxy reads and getAttribute()
        // would disagree on hyphenated keys.
        const accessor = `get${toPascalCase(prop)}Attribute`
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

    /** `delete user.name` must remove the attribute, not a property of the target. */
    deleteProperty(target, prop) {
        if (typeof prop === 'symbol') return Reflect.deleteProperty(target, prop)
        if (target.relationLoaded(prop)) { target.unsetRelation(prop); return true }
        if (target.getRawAttribute(prop) !== undefined) { target.unsetAttribute(prop); return true }
        return Reflect.deleteProperty(target, prop)
    },

    /**
     * Without these two, `Object.keys(user)`, `Object.entries(user)` and
     * `{...user}` all came back empty — the attributes live in a WeakMap, not
     * on the target.
     */
    ownKeys(target) {
        return [...new Set([
            ...Object.keys(target.getAttributes()),
            ...Object.keys(target.getRelations()),
        ])]
    },

    getOwnPropertyDescriptor(target, prop) {
        if (typeof prop === 'string'
            && (target.getRawAttribute(prop) !== undefined || target.relationLoaded(prop))) {
            return {
                value: target.relationLoaded(prop) ? target.getRelation(prop) : target.getAttribute(prop),
                enumerable: true,
                configurable: true,
                writable: true,
            }
        }
        return Reflect.getOwnPropertyDescriptor(target, prop)
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
