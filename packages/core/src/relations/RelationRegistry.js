/**
 * @eloquentjs/core — Relations
 *
 * Relation objects are returned from model methods. They are lazy (call .get()
 * or await them), support eager loading, and — like Eloquent — behave as query
 * builders: every builder method is available on the relation and applies to
 * the relation's own query.
 *
 *   await user.posts().where('published', true).latest().limit(5).get()
 *   await user.posts().paginate(1, 20)
 *   user.posts().getQuery()          // the underlying QueryBuilder
 *
 * Key design: eagerLoad() receives the relation name from the QueryBuilder
 * (i.e. the method name the user called with `.with('posts')`) and uses
 * THAT name to setRelation(), not an inferred name from the Related model.
 */

import { Collection } from '../Collection.js'
import { inferForeignKey, toSnakeCase } from '../utils.js'
import { RelationNotFoundException } from '../errors.js'

function getResolver(ModelClass) {
    // Import lazily to avoid circular dep at module load time
    return ModelClass.getResolver()
}

/** Index rows by a key without prototype-pollution hazards (`__proto__` etc). */
function indexBy(items, keyFn) {
    const map = new Map()
    for (const item of items) map.set(String(keyFn(item)), item)
    return map
}

/** indexBy, but the FIRST item per key wins — for an ordered ofMany batch. */
function firstBy(items, keyFn) {
    const map = new Map()
    for (const item of items) {
        const k = String(keyFn(item))
        if (!map.has(k)) map.set(k, item)
    }
    return map
}

function groupBy(items, keyFn) {
    const map = new Map()
    for (const item of items) {
        const k = String(keyFn(item))
        if (!map.has(k)) map.set(k, [])
        map.get(k).push(item)
    }
    return map
}

// ─── Relation base ───────────────────────────────────────────────────────────
/**
 * Shared builder passthrough. Chainable methods record a constraint applied to
 * the relation's query; terminal methods build the query and execute.
 */
class Relation {
    constructor(parent, Related) {
        this._parent = parent
        this._Related = Related
        /** @type {((qb: any) => void)[]} */
        this._constraints = []
        this._default = undefined
    }

    /**
     * The base query for this relation — subclasses implement.
     * @returns {import('../QueryBuilder.js').QueryBuilder}
     */
    _baseQuery() {
        throw new Error(`${this.constructor.name} must implement _baseQuery()`)
    }

    /** Attributes that tie a new related record to this parent. */
    _linkAttributes() { return {} }

    /**
     * The relation's query with all recorded constraints applied.
     * @returns {import('../QueryBuilder.js').QueryBuilder}
     */
    getQuery() {
        const qb = this._baseQuery()
        for (const fn of this._constraints) fn(qb)
        return qb
    }

    // The most-used terminal methods are declared rather than generated below,
    // so subclasses can override them and the types can see them.
    /** @returns {Promise<any>} */
    get() { return this.getQuery().get() }
    /** @returns {Promise<any>} */
    first() { return this.getQuery().first() }
    lazy(chunkSize) { return this.getQuery().lazy(chunkSize) }
    cursor() { return this.getQuery().cursor() }

    /**
     * Keys used to correlate a subquery against the parent table, for
     * QueryBuilder.whereHas() / withCount(). Relations that cannot be
     * expressed as a correlated subquery return undefined.
     * @returns {{Related: Function, foreignKey: string, localKey: string, extraWheres?: Record<string, any>}|undefined}
     */
    correlationKeys() { return undefined }

    /** Value returned by a to-one relation when nothing matches. */
    withDefault(attributes = {}) {
        this._default = attributes
        return this
    }

    _applyDefault(model) {
        if (model || this._default === undefined) return model
        const fresh = new this._Related()
        const attrs = typeof this._default === 'function' ? this._default() : this._default
        if (attrs && typeof attrs === 'object') fresh.forceFill(attrs)
        return fresh
    }

    then(res, rej) { return this.get().then(res, rej) }
}

// Chainable builder methods: recorded and replayed onto the relation's query.
const CHAINABLE = [
    'where', 'orWhere', 'whereNot', 'orWhereNot', 'whereIn', 'whereNotIn',
    'orWhereIn', 'orWhereNotIn', 'whereNull', 'whereNotNull', 'orWhereNull',
    'orWhereNotNull', 'whereBetween', 'whereNotBetween', 'orWhereBetween',
    'whereLike', 'whereNotLike', 'whereRaw', 'whereDate', 'whereTime',
    'whereYear', 'whereMonth', 'whereDay', 'whereColumn', 'whereJsonContains',
    'whereHas', 'orWhereHas', 'whereDoesntHave', 'has', 'doesntHave',
    'withCount', 'withSum', 'withAvg', 'withMax', 'withMin', 'withExists',
    'select', 'addSelect', 'selectRaw', 'distinct',
    'orderBy', 'orderByDesc', 'orderByRaw', 'inRandomOrder', 'latest', 'oldest',
    'reorder', 'groupBy', 'groupByRaw', 'having', 'havingRaw',
    'limit', 'take', 'offset', 'skip', 'forPage',
    'with', 'join', 'leftJoin', 'rightJoin', 'crossJoin',
    'withTrashed', 'onlyTrashed', 'withoutGlobalScope',
    'lockForUpdate', 'sharedLock', 'tap',
]

// Terminal methods: run against the built query. get/first/lazy/cursor are
// declared on the class above instead.
const TERMINAL = [
    'firstOrFail', 'sole', 'find', 'findOr', 'count', 'min', 'max',
    'sum', 'avg', 'exists', 'doesntExist', 'pluck', 'value', 'paginate',
    'simplePaginate', 'chunk', 'chunkById', 'each', 'update', 'updateQuietly',
    'delete', 'increment', 'decrement', 'toSQL', 'dump',
]

for (const method of CHAINABLE) {
    Relation.prototype[method] = function (...args) {
        this._constraints.push(qb => qb[method](...args))
        return this
    }
}

for (const method of TERMINAL) {
    Relation.prototype[method] = function (...args) {
        return this.getQuery()[method](...args)
    }
}

/** Mixin for relations that can create related records with the key pre-filled. */
const HasRelatedWrites = {
    async create(attrs = {}) {
        return this._Related.create({ ...attrs, ...this._linkAttributes() })
    },

    async createMany(rows = []) {
        const created = []
        for (const row of rows) created.push(await this.create(row))
        return new Collection(created)
    },

    async forceCreate(attrs = {}) {
        const model = new this._Related()
        model.forceFill({ ...attrs, ...this._linkAttributes() })
        await model.save()
        return model
    },

    async save(model) {
        for (const [k, v] of Object.entries(this._linkAttributes())) model.setAttribute(k, v)
        await model.save()
        return model
    },

    async saveMany(models) {
        for (const m of models) await this.save(m)
        return new Collection([...models])
    },

    async firstOrCreate(conditions = {}, values = {}) {
        const found = await this.getQuery().where(conditions).first()
        return found ?? this.create({ ...conditions, ...values })
    },

    async firstOrNew(conditions = {}, values = {}) {
        const found = await this.getQuery().where(conditions).first()
        if (found) return found
        const model = new this._Related()
        model.forceFill({ ...conditions, ...values, ...this._linkAttributes() })
        return model
    },

    async updateOrCreate(conditions = {}, values = {}) {
        const found = await this.getQuery().where(conditions).first()
        if (found) { await found.update(values); return found }
        return this.create({ ...conditions, ...values })
    },
}

// ─── HasOne / HasMany ────────────────────────────────────────────────────────
class HasOneOrMany extends Relation {
    constructor(parent, Related, foreignKey, localKey) {
        super(parent, Related)
        this._foreignKey = foreignKey ?? inferForeignKey(parent.constructor)
        this._localKey = localKey ?? parent.constructor.primaryKey
        /** @type {{column: string, direction: string}|null} */
        this._ofMany = null
    }

    _parentKey() { return this._parent.getAttribute(this._localKey) }

    _baseQuery() { return this._Related.query().where(this._foreignKey, this._parentKey()) }

    /** Ordering that picks the ofMany winner; a no-op unless ofMany() was called. */
    _applyOfMany(qb) {
        if (this._ofMany) qb.orderBy(this._ofMany.column, this._ofMany.direction)
        return qb
    }

    _linkAttributes() { return { [this._foreignKey]: this._parentKey() } }

    correlationKeys() {
        return { Related: this._Related, foreignKey: this._foreignKey, localKey: this._localKey }
    }

    /** Shared eager-load fetch: one query for the whole batch. */
    async _eagerFetch(models, constraints, nested) {
        // Null local keys cannot match anything; excluding them keeps the IN list
        // small and avoids `IN (NULL)`.
        const ids = [...new Set(
            models.map(m => m.getAttribute(this._localKey)).filter(v => v != null)
        )]
        if (!ids.length) return []

        const qb = this._Related.query().whereIn(this._foreignKey, ids)
        this._applyOfMany(qb)
        for (const fn of this._constraints) fn(qb)
        constraints?.(qb)
        if (nested) qb.with(nested)
        return qb.get()
    }
}

Object.assign(HasOneOrMany.prototype, HasRelatedWrites)

class HasOne extends HasOneOrMany {
    /**
     * One-of-many: the single related row that wins on `column` — Laravel's
     * `hasOne(...)->latestOfMany()`. Turns a hasMany shape into a hasOne.
     * @param {string} [column] defaults to the related model's created_at
     * @param {'MAX'|'MIN'} [aggregate]
     */
    ofMany(column = null, aggregate = 'MAX') {
        this._ofMany = {
            column: column ?? this._Related.createdAtColumn,
            direction: String(aggregate).toUpperCase() === 'MIN' ? 'asc' : 'desc',
        }
        return this
    }

    latestOfMany(column = null) { return this.ofMany(column, 'MAX') }
    oldestOfMany(column = null) { return this.ofMany(column, 'MIN') }

    _baseQuery() {
        // limit(1) is safe here but NOT in _eagerFetch, which batches every
        // parent into one query — see eagerLoad().
        return this._ofMany ? this._applyOfMany(super._baseQuery()).limit(1) : super._baseQuery()
    }

    async get() { return this._applyDefault(await this.getQuery().first()) }

    async eagerLoad(models, relName, constraints, nested) {
        const results = await this._eagerFetch(models, constraints, nested)
        // ponytail: ofMany picks the winner per parent from the ordered batch in
        // JS — one query, but it reads every related row. Swap in a correlated
        // subquery if the child table is large enough for that to hurt.
        const map = this._ofMany ? firstBy(results, r => r.getAttribute(this._foreignKey))
            : indexBy(results, r => r.getAttribute(this._foreignKey))
        for (const model of models) {
            const key = model.getAttribute(this._localKey)
            model.setRelation(relName, this._applyDefault(map.get(String(key)) ?? null))
        }
    }
}

class HasMany extends HasOneOrMany {
    async eagerLoad(models, relName, constraints, nested) {
        const results = await this._eagerFetch(models, constraints, nested)
        const map = groupBy(results, r => r.getAttribute(this._foreignKey))
        for (const model of models) {
            const key = model.getAttribute(this._localKey)
            model.setRelation(relName, new Collection(map.get(String(key)) ?? []))
        }
    }
}

// ─── BelongsTo ───────────────────────────────────────────────────────────────
class BelongsTo extends Relation {
    constructor(parent, Related, foreignKey, ownerKey) {
        super(parent, Related)
        this._foreignKey = foreignKey ?? inferForeignKey(Related)
        this._ownerKey = ownerKey ?? Related.primaryKey
    }

    _baseQuery() {
        return this._Related.query().where(this._ownerKey, this._parent.getAttribute(this._foreignKey))
    }

    correlationKeys() {
        // Reversed: the "related" table is matched on its owner key against the
        // parent's foreign key.
        return { Related: this._Related, foreignKey: this._ownerKey, localKey: this._foreignKey }
    }

    async get() {
        if (this._parent.getAttribute(this._foreignKey) == null) return this._applyDefault(null)
        return this._applyDefault(await this.getQuery().first())
    }

    async associate(model) {
        this._parent.setAttribute(this._foreignKey, model.getAttribute(this._ownerKey))
        return this._parent.save()
    }

    async dissociate() {
        this._parent.setAttribute(this._foreignKey, null)
        return this._parent.save()
    }

    async eagerLoad(models, relName, constraints, nested) {
        const ids = [...new Set(models.map(m => m.getAttribute(this._foreignKey)).filter(v => v != null))]

        if (!ids.length) {
            for (const m of models) m.setRelation(relName, this._applyDefault(null))
            return
        }

        const qb = this._Related.query().whereIn(this._ownerKey, ids)
        for (const fn of this._constraints) fn(qb)
        constraints?.(qb)
        if (nested) qb.with(nested)

        const results = await qb.get()
        const map = indexBy(results, r => r.getAttribute(this._ownerKey))

        for (const model of models) {
            const key = model.getAttribute(this._foreignKey)
            model.setRelation(relName, this._applyDefault(map.get(String(key)) ?? null))
        }
    }
}

// ─── BelongsToMany ───────────────────────────────────────────────────────────
/**
 * Implemented as a JOIN through the pivot table so that every builder method
 * (`where`, `orderBy`, `limit`, `paginate`, …) constrains the *database* query.
 * The previous implementation collected those constraints and never applied
 * them, so `user.roles().where('active', true)` returned all roles.
 */
class BelongsToMany extends Relation {
    constructor(parent, Related, pivotTable, foreignKey, relatedKey) {
        super(parent, Related)
        const parentSnake = toSnakeCase(parent.constructor.name)
        const relatedSnake = toSnakeCase(Related.name)

        this._pivotTable = pivotTable ?? [parentSnake, relatedSnake].sort().join('_')
        this._foreignKey = foreignKey ?? `${parentSnake}_id`
        this._relatedKey = relatedKey ?? `${relatedSnake}_id`
        this._pivotCols = []
        this._pivotWheres = []
        this._pivotTimestamps = false
        this._pivotAccessor = 'pivot'
    }

    withPivot(...cols) {
        this._pivotCols.push(...cols.flat())
        return this
    }

    /** Maintain created_at/updated_at on the pivot rows. */
    withTimestamps() {
        this._pivotTimestamps = true
        this._pivotCols.push('created_at', 'updated_at')
        return this
    }

    /** Rename the pivot accessor: `.as('membership')` → `model.membership`. */
    as(accessor) {
        this._pivotAccessor = accessor
        return this
    }

    /** Constrain on a pivot column. */
    wherePivot(column, operator, value) {
        if (value === undefined) { value = operator; operator = '=' }
        this._pivotWheres.push({ column, operator, value })
        return this
    }

    wherePivotIn(column, values) {
        this._constraints.push(qb => qb.whereIn(`${this._pivotTable}.${column}`, values))
        return this
    }

    /** A pivot value applied to both the filter and to attach()'s payload. */
    withPivotValue(column, value) {
        this._pivotValues = { ...(this._pivotValues ?? {}), [column]: value }
        return this.wherePivot(column, value)
    }

    _parentId() { return this._parent.getAttribute(this._parent.constructor.primaryKey) }

    _requireJoins() {
        const resolver = getResolver(this._Related)
        if (resolver.supportsJoins === false) {
            throw new Error(
                `[EloquentJS] ${resolver.constructor.name} cannot join, so belongsToMany() is ` +
                `unsupported on this connection. Use embedded arrays or an aggregation instead.`
            )
        }
        return resolver
    }

    _baseQuery() {
        this._requireJoins()
        const related = this._Related.getTable()
        const pivot = this._pivotTable
        const qb = this._Related.query()
            .select(`${related}.*`)
            .join(pivot, `${pivot}.${this._relatedKey}`, '=', `${related}.${this._Related.primaryKey}`)
            .where(`${pivot}.${this._foreignKey}`, this._parentId())

        // Double-quoted identifiers are accepted by both SQL drivers.
        for (const col of [...new Set(this._pivotCols)]) {
            qb.addSelect({ raw: `"${pivot}"."${col}" AS "_pivot_${col}"` })
        }
        for (const w of this._pivotWheres) {
            qb.where(`${pivot}.${w.column}`, w.operator, w.value)
        }
        return qb
    }

    /** Split `_pivot_*` columns off the attributes and onto the pivot accessor. */
    _extractPivot(model) {
        const pivot = {}
        for (const [key, value] of Object.entries(model.getAttributes())) {
            if (key === '_pivot_foreign_id') { model.unsetAttribute(key); continue }
            if (key.startsWith('_pivot_')) {
                pivot[key.slice('_pivot_'.length)] = value
                model.unsetAttribute(key)
            }
        }
        // setRelation, NOT setAttribute: as an attribute it would serialise into
        // toJSON() and be written back to the main table on the next save().
        model.setRelation(this._pivotAccessor, pivot)
        return model
    }

    async get() {
        const models = await this.getQuery().get()
        return new Collection(models.map(m => this._extractPivot(m)))
    }

    async first() {
        const model = await this.getQuery().first()
        return model ? this._extractPivot(model) : null
    }

    async attach(id, pivotAttrs = {}) {
        const parentId = this._parentId()
        const ids = [id].flat().map(v => (v?.getAttribute ? v.getAttribute(this._Related.primaryKey) : v))
        const resolver = getResolver(this._Related)
        const now = new Date()
        for (const relId of ids) {
            await resolver.insert(this._pivotTable, {
                [this._foreignKey]: parentId,
                [this._relatedKey]: relId,
                ...(this._pivotValues ?? {}),
                ...(this._pivotTimestamps ? { created_at: now, updated_at: now } : {}),
                ...pivotAttrs,
            })
        }
        return ids.length
    }

    async detach(id) {
        const resolver = getResolver(this._Related)
        const base = { [this._foreignKey]: this._parentId() }
        if (id === undefined) return resolver.delete(this._pivotTable, base)

        // A conditions object maps to `col = value`; an array has to become a
        // separate delete per id (the old code compared a column to an array).
        let removed = 0
        for (const relId of [id].flat()) {
            removed += await resolver.delete(this._pivotTable, { ...base, [this._relatedKey]: relId })
        }
        return removed
    }

    /**
     * Make the pivot rows exactly match `ids`.
     * @param {(string|number)[]|Record<string|number, Record<string, any>>} ids
     * @param {boolean} detaching
     */
    async sync(ids, detaching = true) {
        // Compare as strings throughout: DB keys come back as numbers while
        // Object.keys() always yields strings, so `includes()` never matched and
        // every sync detached and re-attached everything.
        const current = (await this.currentPivotIds()).map(String)
        const incoming = Array.isArray(ids) ? ids.map(String) : Object.keys(ids).map(String)

        const toAttach = incoming.filter(id => !current.includes(id))
        const toDetach = detaching ? current.filter(id => !incoming.includes(id)) : []

        for (const id of toDetach) await this.detach(id)
        for (const id of toAttach) {
            await this.attach(id, Array.isArray(ids) ? {} : (ids[id] ?? {}))
        }
        return { attached: toAttach, detached: toDetach }
    }

    /** sync() without detaching. */
    async syncWithoutDetaching(ids) { return this.sync(ids, false) }

    async toggle(id) {
        const current = (await this.currentPivotIds()).map(String)
        const attached = []
        const detached = []
        for (const relId of [id].flat()) {
            if (current.includes(String(relId))) { await this.detach(relId); detached.push(relId) }
            else { await this.attach(relId); attached.push(relId) }
        }
        return { attached, detached }
    }

    /** The related ids currently in the pivot table — no model hydration. */
    async currentPivotIds() {
        const resolver = getResolver(this._Related)
        const rows = await resolver.select(this._pivotTable, {
            selects: [this._relatedKey],
            wheres: [{ column: this._foreignKey, operator: '=', value: this._parentId(), boolean: 'and' }],
        })
        return rows.map(r => r[this._relatedKey])
    }

    async updateExistingPivot(id, attrs) {
        return getResolver(this._Related).update(
            this._pivotTable,
            { [this._foreignKey]: this._parentId(), [this._relatedKey]: id },
            this._pivotTimestamps ? { ...attrs, updated_at: new Date() } : attrs
        )
    }

    /** Create the related model and attach it in one step. */
    async create(attrs = {}, pivotAttrs = {}) {
        const model = await this._Related.create(attrs)
        await this.attach(model.getAttribute(this._Related.primaryKey), pivotAttrs)
        return model
    }

    async createMany(rows = [], pivotAttrs = {}) {
        const created = []
        for (const row of rows) created.push(await this.create(row, pivotAttrs))
        return new Collection(created)
    }

    async save(model, pivotAttrs = {}) {
        await model.save()
        await this.attach(model.getAttribute(this._Related.primaryKey), pivotAttrs)
        return model
    }

    async saveMany(models, pivotAttrs = {}) {
        for (const m of models) await this.save(m, pivotAttrs)
        return new Collection([...models])
    }

    async eagerLoad(models, relName, constraints, nested) {
        this._requireJoins()
        const related = this._Related.getTable()
        const pivot = this._pivotTable
        const parentIds = [...new Set(
            models.map(m => m.getAttribute(m.constructor.primaryKey)).filter(v => v != null)
        )]

        if (!parentIds.length) {
            for (const m of models) m.setRelation(relName, new Collection([]))
            return
        }

        const qb = this._Related.query()
            .select(`${related}.*`)
            .addSelect({ raw: `"${pivot}"."${this._foreignKey}" AS "_pivot_foreign_id"` })
            .join(pivot, `${pivot}.${this._relatedKey}`, '=', `${related}.${this._Related.primaryKey}`)
            .whereIn(`${pivot}.${this._foreignKey}`, parentIds)

        for (const col of [...new Set(this._pivotCols)]) {
            qb.addSelect({ raw: `"${pivot}"."${col}" AS "_pivot_${col}"` })
        }
        for (const w of this._pivotWheres) qb.where(`${pivot}.${w.column}`, w.operator, w.value)
        for (const fn of this._constraints) fn(qb)
        constraints?.(qb)
        if (nested) qb.with(nested)

        const results = await qb.get()
        const map = groupBy(results, r => r.getRawAttribute('_pivot_foreign_id'))
        for (const r of results) this._extractPivot(r)

        for (const model of models) {
            const pk = model.getAttribute(model.constructor.primaryKey)
            model.setRelation(relName, new Collection(map.get(String(pk)) ?? []))
        }
    }
}

// ─── HasManyThrough / HasOneThrough ──────────────────────────────────────────
/**
 * Related is reached via an intermediate table:
 *   Country -> User (through) -> Post (related)
 * Expressed as a JOIN so constraints, ordering and nested eager loads work.
 */
class HasManyThrough extends Relation {
    constructor(parent, Related, Through, firstKey, secondKey, localKey, throughKey) {
        super(parent, Related)
        this._Through = Through
        this._firstKey = firstKey ?? inferForeignKey(parent.constructor)   // through.parent_id
        this._secondKey = secondKey ?? inferForeignKey(Through)            // related.through_id
        this._localKey = localKey ?? parent.constructor.primaryKey
        this._throughKey = throughKey ?? Through.primaryKey
    }

    _joined(qb) {
        const related = this._Related.getTable()
        const through = this._Through.getTable()
        qb.select(`${related}.*`)
            .join(through, `${through}.${this._throughKey}`, '=', `${related}.${this._secondKey}`)

        // The through table is joined directly (never via Through.query()), so its
        // own soft-delete scope is never applied automatically — a deleted "through"
        // row (e.g. a removed User) would otherwise still bridge to its related rows.
        if (this._Through.softDeletes) {
            qb.whereNull(`${through}.${this._Through.deletedAtColumn}`)
        }

        return qb
    }

    _baseQuery() {
        const through = this._Through.getTable()
        return this._joined(this._Related.query())
            .where(`${through}.${this._firstKey}`, this._parent.getAttribute(this._localKey))
    }

    async eagerLoad(models, relName, constraints, nested) {
        const through = this._Through.getTable()
        const ids = [...new Set(
            models.map(m => m.getAttribute(this._localKey)).filter(v => v != null)
        )]
        if (!ids.length) {
            for (const m of models) m.setRelation(relName, new Collection([]))
            return
        }

        const qb = this._joined(this._Related.query())
            .addSelect({ raw: `"${through}"."${this._firstKey}" AS "_parent_id"` })
            .whereIn(`${through}.${this._firstKey}`, ids)

        // constraints and nested were accepted and ignored before this.
        for (const fn of this._constraints) fn(qb)
        constraints?.(qb)
        if (nested) qb.with(nested)

        const results = await qb.get()
        const map = groupBy(results, r => r.getRawAttribute('_parent_id'))
        for (const r of results) r.unsetAttribute('_parent_id')

        for (const model of models) {
            const key = model.getAttribute(this._localKey)
            model.setRelation(relName, new Collection(map.get(String(key)) ?? []))
        }
    }
}

class HasOneThrough extends HasManyThrough {
    async get() { return this._applyDefault(await this.getQuery().first()) }

    async eagerLoad(models, relName, constraints, nested) {
        await super.eagerLoad(models, relName, constraints, nested)
        for (const model of models) {
            const many = model.getRelation(relName)
            model.setRelation(relName, this._applyDefault(many?.[0] ?? null))
        }
    }
}

// ─── MorphOne / MorphMany ────────────────────────────────────────────────────
class MorphOneOrMany extends Relation {
    constructor(parent, Related, morphName) {
        super(parent, Related)
        this._typeCol = `${morphName}_type`
        this._idCol = `${morphName}_id`
        this._morphName = morphName
    }

    _morphType() { return ModelRegistry.aliasFor(this._parent.constructor) }
    _parentId() { return this._parent.getAttribute(this._parent.constructor.primaryKey) }

    _baseQuery() {
        return this._Related.query()
            .where(this._typeCol, this._morphType())
            .where(this._idCol, this._parentId())
    }

    _linkAttributes() {
        return { [this._typeCol]: this._morphType(), [this._idCol]: this._parentId() }
    }

    correlationKeys() {
        return {
            Related: this._Related,
            foreignKey: this._idCol,
            localKey: this._parent.constructor.primaryKey,
            extraWheres: { [this._typeCol]: this._morphType() },
        }
    }

    async _eagerFetch(models, constraints, nested) {
        const ids = [...new Set(
            models.map(m => m.getAttribute(m.constructor.primaryKey)).filter(v => v != null)
        )]
        if (!ids.length) return []

        const qb = this._Related.query()
            .where(this._typeCol, this._morphType())
            .whereIn(this._idCol, ids)
        for (const fn of this._constraints) fn(qb)
        constraints?.(qb)
        if (nested) qb.with(nested)
        return qb.get()
    }
}

Object.assign(MorphOneOrMany.prototype, HasRelatedWrites)

class MorphMany extends MorphOneOrMany {
    async eagerLoad(models, relName, constraints, nested) {
        const results = await this._eagerFetch(models, constraints, nested)
        const map = groupBy(results, r => r.getAttribute(this._idCol))
        for (const model of models) {
            const pk = model.getAttribute(model.constructor.primaryKey)
            model.setRelation(relName, new Collection(map.get(String(pk)) ?? []))
        }
    }
}

class MorphOne extends MorphOneOrMany {
    async get() { return this._applyDefault(await this.getQuery().first()) }

    async eagerLoad(models, relName, constraints, nested) {
        // nested was honoured by MorphMany and dropped here.
        const results = await this._eagerFetch(models, constraints, nested)
        const map = indexBy(results, r => r.getAttribute(this._idCol))
        for (const model of models) {
            const pk = model.getAttribute(model.constructor.primaryKey)
            model.setRelation(relName, this._applyDefault(map.get(String(pk)) ?? null))
        }
    }
}

// ─── MorphToMany / MorphedByMany ─────────────────────────────────────────────
/** A many-to-many whose pivot also stores the parent's morph type. */
class MorphToMany extends BelongsToMany {
    constructor(parent, Related, morphName, pivotTable, relatedKey, inverse = false) {
        const relatedSnake = toSnakeCase(Related.name)
        super(
            parent, Related,
            pivotTable ?? `${morphName}s`,
            inverse ? relatedKey ?? `${relatedSnake}_id` : `${morphName}_id`,
            inverse ? `${morphName}_id` : relatedKey ?? `${relatedSnake}_id`,
        )
        this._morphType = `${morphName}_type`
        this._inverse = inverse
        const type = inverse
            ? ModelRegistry.aliasFor(Related)
            : ModelRegistry.aliasFor(parent.constructor)
        this.withPivotValue(this._morphType, type)
    }
}

// ─── MorphTo (inverse) ───────────────────────────────────────────────────────
class MorphTo extends Relation {
    constructor(parent, morphName) {
        super(parent, null)
        this._typeCol = `${morphName}_type`
        this._idCol = `${morphName}_id`
    }

    _resolveType(type) {
        const Related = ModelRegistry.get(type)
        if (!Related) {
            throw new RelationNotFoundException(
                `[EloquentJS] MorphTo: no model registered for morph type "${type}". ` +
                `Call ModelRegistry.register(YourModel) or ModelRegistry.morphMap({ ${type}: YourModel }).`
            )
        }
        return Related
    }

    _baseQuery() {
        const Related = this._resolveType(this._parent.getAttribute(this._typeCol))
        return Related.query().where(Related.primaryKey, this._parent.getAttribute(this._idCol))
    }

    async get() {
        const type = this._parent.getAttribute(this._typeCol)
        const id = this._parent.getAttribute(this._idCol)
        if (!type || id == null) return null
        return this.getQuery().first()
    }

    /** Point this morph at a different model. */
    async associate(model) {
        this._parent.setAttribute(this._typeCol, ModelRegistry.aliasFor(model.constructor))
        this._parent.setAttribute(this._idCol, model.getAttribute(model.constructor.primaryKey))
        return this._parent.save()
    }

    async eagerLoad(models, relName, constraints, nested) {
        // Group models by morph type
        const groups = new Map()
        for (const m of models) {
            const type = m.getAttribute(this._typeCol)
            if (!type) { m.setRelation(relName, null); continue }
            if (!groups.has(type)) groups.set(type, [])
            groups.get(type).push(m)
        }

        for (const [type, group] of groups) {
            const Related = ModelRegistry.get(type)
            if (!Related) { for (const m of group) m.setRelation(relName, null); continue }

            const ids = [...new Set(group.map(m => m.getAttribute(this._idCol)).filter(v => v != null))]
            if (!ids.length) { for (const m of group) m.setRelation(relName, null); continue }

            const qb = Related.query().whereIn(Related.primaryKey, ids)
            for (const fn of this._constraints) fn(qb)
            constraints?.(qb)
            if (nested) qb.with(nested)

            const results = await qb.get()
            const map = indexBy(results, r => r.getAttribute(Related.primaryKey))

            for (const model of group) {
                model.setRelation(relName, map.get(String(model.getAttribute(this._idCol))) ?? null)
            }
        }
    }
}

// ─── Registry ─────────────────────────────────────────────────────────────────
/** alias → Model, plus the reverse lookup used when writing morph types. */
const _morphMap = new Map()
const _morphAliases = new Map()

export const ModelRegistry = {
    /**
     * Register a model under an alias. The alias — not the class name — is what
     * gets stored in `*_type` columns, so renaming or minifying a class no
     * longer orphans existing polymorphic rows.
     * @param {Function} ModelClass
     * @param {string} [alias] defaults to the class name
     */
    register(ModelClass, alias = ModelClass.name) {
        _morphMap.set(alias, ModelClass)
        _morphAliases.set(ModelClass, alias)
        return this
    },

    /** Register several aliases at once — Laravel's Relation::morphMap(). */
    morphMap(map) {
        for (const [alias, ModelClass] of Object.entries(map)) this.register(ModelClass, alias)
        return this
    },

    get(name) { return _morphMap.get(name) },

    /** The alias to store for a class; falls back to its name. */
    aliasFor(ModelClass) { return _morphAliases.get(ModelClass) ?? ModelClass.name },

    all() { return new Map(_morphMap) },

    clear() { _morphMap.clear(); _morphAliases.clear() },
}

export const RelationRegistry = {
    hasOne: (p, R, fk, lk) => new HasOne(p, R, fk, lk),
    hasOneOfMany: (p, R, column, aggregate, fk, lk) => new HasOne(p, R, fk, lk).ofMany(column, aggregate),
    hasMany: (p, R, fk, lk) => new HasMany(p, R, fk, lk),
    belongsTo: (p, R, fk, ok) => new BelongsTo(p, R, fk, ok),
    belongsToMany: (p, R, pt, fk, rk) => new BelongsToMany(p, R, pt, fk, rk),
    // localKey/throughKey used to be dropped here even though the constructor
    // accepted them.
    hasManyThrough: (p, R, T, fk1, fk2, lk, tk) => new HasManyThrough(p, R, T, fk1, fk2, lk, tk),
    hasOneThrough: (p, R, T, fk1, fk2, lk, tk) => new HasOneThrough(p, R, T, fk1, fk2, lk, tk),
    morphOne: (p, R, name) => new MorphOne(p, R, name),
    morphMany: (p, R, name) => new MorphMany(p, R, name),
    morphTo: (p, name) => new MorphTo(p, name),
    morphToMany: (p, R, name, pt, rk) => new MorphToMany(p, R, name, pt, rk, false),
    morphedByMany: (p, R, name, pt, rk) => new MorphToMany(p, R, name, pt, rk, true),
}
