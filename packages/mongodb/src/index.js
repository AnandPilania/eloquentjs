/**
 * @eloquentjs/mongodb — MongoDB Driver
 *
 * Translates the QueryBuilder context into MongoDB filter/pipeline objects.
 *
 * `id` is an alias of `_id` in both directions: reads expose the ObjectId as a
 * string under both keys, and every write/filter path maps `id` back to `_id`
 * and coerces the value to an ObjectId. That means the default
 * `Model.primaryKey = 'id'` works unchanged — no `static primaryKey = '_id'`
 * needed. (Before this, `find()` never matched and `save()` updated 0 docs.)
 *
 * Supports multiple named connections via a Map — mirrors the PgSQL driver.
 */

import { MongoClient, ObjectId } from 'mongodb'
import { setResolver, getResolver, runInTransaction } from '@eloquentjs/core'

/**
 * @typedef {Object} ConnectOptions
 * @property {string} [url]
 * @property {string} [database]
 */

// ─── Per-connection registries ────────────────────────────────────────────────
// Keyed by connectionName so multiple named connections each get their own
// client and db reference.  Module-level singletons would silently overwrite
// earlier connections whenever connect() is called a second time.
const _clients = new Map()
const _dbs = new Map()

function _getClient(connectionName = 'default') {
    const client = _clients.get(connectionName)
    if (!client) throw new Error(`[EloquentJS/mongodb] No connection "${connectionName}". Did you call connect()?`)
    return client
}

function _getDb(connectionName = 'default') {
    const db = _dbs.get(connectionName)
    if (!db) throw new Error(`[EloquentJS/mongodb] No connection "${connectionName}". Did you call connect()?`)
    return db
}

// ─── connect() ───────────────────────────────────────────────────────────────
/**
 * @param {ConnectOptions & Record<string, any>} options
 * @param {string} connectionName
 * @returns {Promise<MongoResolver>}
 */
export async function connect({ url, database, username, password, ...options } = {}, connectionName = 'default') {
    // Close existing connection for this name before replacing it
    if (_clients.has(connectionName)) {
        await _clients.get(connectionName).close().catch(() => { })
        _clients.delete(connectionName)
        _dbs.delete(connectionName)
    }

    // MongoClientOptions has no top-level `username`/`password` — they must be
    // nested under `auth`, or the driver rejects them as unrecognized options.
    const auth = (username || password) ? { username, password } : undefined

    const client = new MongoClient(url, { ...options, ...(auth ? { auth } : {}) })
    await client.connect()
    const db = client.db(database)

    _clients.set(connectionName, client)
    _dbs.set(connectionName, db)

    const resolver = new MongoResolver(db, connectionName)
    setResolver(resolver, connectionName)
    return resolver
}

/**
 * Returns the raw mongodb.Db for the named connection (for advanced use).
 * @param {string} connectionName
 */
export function getDb(connectionName = 'default') {
    return _getDb(connectionName)
}

/**
 * Disconnect and remove the named connection (or all if name omitted).
 * @param {string} [connectionName]
 */
export async function disconnect(connectionName) {
    if (connectionName) {
        await _clients.get(connectionName)?.close().catch(() => { })
        _clients.delete(connectionName)
        _dbs.delete(connectionName)
    } else {
        await Promise.all([..._clients.values()].map(c => c.close().catch(() => { })))
        _clients.clear()
        _dbs.clear()
    }
}

/**
 * Run a function inside a MongoDB session transaction. Rolls back on throw.
 * Delegates to the resolver so model writes inside participate — see
 * MongoResolver.transaction().
 * @template T
 * @param {(tx: any) => Promise<T>} callback
 * @param {string} connectionName
 * @returns {Promise<T>}
 */
export async function transaction(callback, connectionName = 'default') {
    return getResolver(connectionName).transaction(callback)
}

// ─── MongoResolver ───────────────────────────────────────────────────────────
export class MongoResolver {
    /**
     * @param {import('mongodb').Db} db
     * @param {string} connectionName
     */
    /**
     * Relations that need a JOIN (belongsToMany, hasManyThrough) check this and
     * throw a clear error rather than silently ignoring the join clause.
     */
    supportsJoins = false

    constructor(db, connectionName = 'default', session = null) {
        this._db = db
        this._connectionName = connectionName
        /** @type {import('mongodb').ClientSession | null} */
        this._session = session
    }

    /** @param {string} table */
    _col(table) { return this._db.collection(table) }

    /**
     * Run a raw database command. MongoDB has no SQL, so `sql` is a command
     * document (or its JSON string) passed to db.command().
     * @param {Record<string, any>|string} command
     */
    async raw(command) {
        const doc = typeof command === 'string' ? JSON.parse(command) : command
        return this._db.command(doc, this._opts)
    }

    /** Options every driver call passes so it joins the active transaction. */
    get _opts() { return this._session ? { session: this._session } : {} }

    // ── TRANSACTIONS ───────────────────────────────────────────────────────────
    /**
     * Start a session transaction and publish a session-bound resolver for the
     * duration of the callback, so model writes inside participate.
     * MongoDB has no savepoints — a nested call joins the outer transaction.
     * @template T
     * @param {(tx: any) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async transaction(fn) {
        if (this._session) return fn(this)   // already in one; no nested transactions in Mongo

        const client = _getClient(this._connectionName)
        const session = client.startSession()
        const scoped = new MongoResolver(this._db, this._connectionName, session)
        try {
            session.startTransaction()
            const result = await runInTransaction(this._connectionName, scoped, () => fn(scoped))
            await session.commitTransaction()
            return result
        } catch (err) {
            await session.abortTransaction().catch(() => { })
            throw err
        } finally {
            await session.endSession()
        }
    }

    /**
     * @param {string} table
     * @param {any} ctx
     * @returns {Promise<Record<string, any>[]>}
     */
    async select(table, ctx) {
        if (ctx.unions?.length) {
            throw new Error('[EloquentJS] MongoDBResolver does not support union() — SQL UNION has no equivalent find() semantics here.')
        }
        const filter = buildFilter(ctx, table)
        let cursor = this._col(table).find(filter, this._opts)

        // Projection
        const selects = ctx.selects ?? ['*']
        if (selects.length && selects[0] !== '*' && !selects[0]?.raw) {
            const proj = {}
            for (const s of selects) proj[mapColumn(s, table)] = 1
            cursor = cursor.project(proj)
        }

        // Sort — combine all orderBys
        if (ctx.orderBys?.length) {
            const sort = {}
            for (const o of ctx.orderBys) {
                if (o.random) continue
                if (o.raw) continue
                sort[mapColumn(o.column, table)] = o.direction === 'DESC' ? -1 : 1
            }
            if (Object.keys(sort).length) cursor = cursor.sort(sort)
        }

        if (ctx.offset) cursor = cursor.skip(ctx.offset)
        if (ctx.limit) cursor = cursor.limit(ctx.limit)

        const docs = await cursor.toArray()
        return docs.map(normalizeDoc)
    }

    /**
     * @param {string} table
     * @param {Record<string, any>} data
     */
    async insert(table, data) {
        const doc = prepareInsertDoc(data)
        const result = await this._col(table).insertOne(doc, this._opts)
        const id = result.insertedId.toString()
        return { ...normalizeDoc(doc), id, _id: id, insertedId: result.insertedId }
    }

    /**
     * @param {string} table
     * @param {Record<string, any>[]} rows
     */
    async insertMany(table, rows) {
        if (!Array.isArray(rows) || !rows.length) return []
        const docs = rows.map(prepareInsertDoc)
        const result = await this._col(table).insertMany(docs, this._opts)
        return docs.map((doc, i) => normalizeDoc({ ...doc, _id: doc._id ?? result.insertedIds[i] }))
    }

    /**
     * @param {string} table
     * @param {Record<string, any>[]} rows
     * @param {string|string[]} uniqueBy - conflict key field(s)
     * @param {string[]|null} update - fields to overwrite on conflict; null = all non-key fields
     * @returns {Promise<number>} matched + upserted count
     */
    async upsert(table, rows, uniqueBy, update = null) {
        const list = [rows].flat()
        if (!list.length) return 0
        const keys = [uniqueBy].flat()

        const ops = list.map(row => {
            const filter = {}
            for (const k of keys) filter[mapColumn(k)] = mapColumn(k) === '_id' ? toObjectIdIfValid(row[k]) : row[k]

            const updateCols = update ?? Object.keys(row).filter(c => !keys.includes(c))
            const $set = Object.fromEntries(
                updateCols
                    .filter(c => row[c] !== undefined && c !== '_id' && c !== 'id')
                    .map(c => [mapColumn(c), row[c]])
            )

            return { updateOne: { filter, update: { $set }, upsert: true } }
        })

        const result = await this._col(table).bulkWrite(ops, this._opts)
        return result.modifiedCount + result.upsertedCount
    }

    /**
     * @param {string} table
     * @param {Record<string, any>} conditions
     * @param {Record<string, any>} data
     * @param {any} [ctx]
     * @returns {Promise<number>}
     */
    async update(table, conditions, data, ctx = null) {
        const filter = ctx ? buildFilter(ctx, table) : buildSimpleFilter(conditions)
        // Drop undefined values and the immutable key — Mongo rejects $set on _id,
        // and `id` is only ever a read-side alias of it.
        const $set = Object.fromEntries(
            Object.entries(data).filter(([k, v]) => v !== undefined && k !== '_id' && k !== 'id')
        )
        if (!Object.keys($set).length) return 0
        const result = await this._col(table).updateMany(filter, { $set }, this._opts)
        return result.modifiedCount
    }

    /**
     * @param {string} table
     * @param {Record<string, any>} conditions
     * @param {any} [ctx]
     * @returns {Promise<number>}
     */
    async delete(table, conditions, ctx = null) {
        const filter = ctx ? buildFilter(ctx, table) : buildSimpleFilter(conditions)
        const result = await this._col(table).deleteMany(filter, this._opts)
        return result.deletedCount
    }

    /**
     * @param {string} table
     * @param {'count'|'sum'|'avg'|'min'|'max'} fn
     * @param {string} column
     * @param {any} ctx
     * @returns {Promise<number | null>}
     */
    async aggregate(table, fn, column, ctx) {
        const match = buildFilter(ctx, table)
        const field = `$${mapColumn(column, table)}`
        const aggMap = {
            count: { $sum: 1 },
            sum: { $sum: field },
            avg: { $avg: field },
            max: { $max: field },
            min: { $min: field },
        }

        // A grouped query aggregates over the *groups*, not the rows —
        // otherwise count() reports the size of the first group.
        const groupBys = ctx?.groupBys ?? []
        /** @type {Record<string, any>[]} */
        const pipeline = [{ $match: match }]
        if (groupBys.length) {
            pipeline.push({
                $group: {
                    _id: Object.fromEntries(groupBys.map(c => [c.replace(/\./g, '_'), `$${mapColumn(c)}`])),
                    _inner: aggMap[fn],
                },
            })
            pipeline.push({
                $group: {
                    _id: null,
                    _result: fn === 'count' ? { $sum: 1 } : { [`$${fn}`]: '$_inner' },
                },
            })
        } else {
            pipeline.push({ $group: { _id: null, _result: aggMap[fn] } })
        }

        const rows = await this._col(table).aggregate(pipeline, this._opts).toArray()
        const val = rows[0]?._result
        return val == null ? (fn === 'count' ? 0 : null) : val
    }

    async increment(table, column, amount, extra, ctx) {
        const filter = buildFilter(ctx, table)
        const update = { $inc: { [mapColumn(column, table)]: amount } }
        if (extra && Object.keys(extra).length) update.$set = extra
        const result = await this._col(table).updateMany(filter, update, this._opts)
        return result.modifiedCount
    }

    async selectPivot() {
        throw new Error('[EloquentJS/mongodb] BelongsToMany pivot queries are not supported in MongoDB. Use embedded arrays or $lookup aggregation instead.')
    }

    async selectPivotMany() {
        throw new Error('[EloquentJS/mongodb] BelongsToMany pivot queries are not supported in MongoDB.')
    }

    async hasManyThrough({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentId }) {
        // Use $lookup — simplified version
        const throughs = await this._col(throughTable)
            .find({ [mapColumn(firstKey)]: toObjectIdIfValid(parentId) }, this._opts).toArray()
        const throughIds = throughs.map(t => t._id)
        const docs = await this._col(relatedTable)
            .find({ [mapColumn(secondKey)]: { $in: throughIds } }, this._opts).toArray()
        return docs.map(normalizeDoc)
    }

    async hasManyThroughMany({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentIds }) {
        const throughs = await this._col(throughTable)
            .find({ [mapColumn(firstKey)]: { $in: parentIds.map(toObjectIdIfValid) } }, this._opts).toArray()
        const parentMap = Object.create(null)
        for (const t of throughs) parentMap[t._id.toString()] = t[mapColumn(firstKey)]

        const throughIds = throughs.map(t => t._id)
        const docs = await this._col(relatedTable)
            .find({ [mapColumn(secondKey)]: { $in: throughIds } }, this._opts).toArray()
        return docs.map(doc => ({
            ...normalizeDoc(doc),
            _parent_id: parentMap[doc[secondKey]?.toString()],
        }))
    }

    async toSQL(table, ctx) {
        return { collection: table, filter: buildFilter(ctx, table) }
    }

    /** @param {string} table */
    async truncate(table) {
        await this._col(table).deleteMany({}, this._opts)
    }

    // ── DDL (MongoDB = schemaless, but we support indexes) ──────────────────────
    async createTable(table, blueprint) {
        try { await this._db.createCollection(table) } catch { }
        const col = this._col(table)
        for (const idx of blueprint.indexes) {
            if (idx.type === 'dropIndex' || idx.type === 'dropUnique') continue
            const keys = Object.fromEntries(idx.columns.map(c => [mapColumn(c), 1]))
            const opts = {}
            if (idx.type === 'unique') opts.unique = true
            if (idx.name) opts.name = idx.name
            await col.createIndex(keys, opts)
        }
    }

    async alterTable(table, blueprint) {
        const col = this._col(table)
        for (const idx of blueprint.indexes) {
            if (idx.type === 'dropIndex' || idx.type === 'dropUnique') {
                try { await col.dropIndex(idx.name) } catch { }
                continue
            }
            const keys = Object.fromEntries(idx.columns.map(c => [mapColumn(c), 1]))
            await col.createIndex(keys, { unique: idx.type === 'unique' })
        }
    }

    async dropTable(table, { ifExists = false } = {}) {
        try {
            await this._col(table).drop()
        } catch (err) {
            if (!ifExists) throw err
        }
    }

    async renameTable(from, to) {
        await this._db.admin().command({
            renameCollection: `${this._db.databaseName}.${from}`,
            to: `${this._db.databaseName}.${to}`,
        })
    }

    async hasTable(table) {
        const cols = await this._db.listCollections({ name: table }).toArray()
        return cols.length > 0
    }

    // Arity is part of the resolver contract; see conformance.js MIN_ARITY.
    async hasColumn(table, column) { return true } // schemaless

    async getColumnListing(table) {
        const doc = await this._col(table).findOne({}, this._opts)
        if (!doc) return []
        // Expose the `id` alias alongside `_id` so callers see the same shape reads have.
        return Object.keys(doc).flatMap(k => (k === '_id' ? ['_id', 'id'] : [k]))
    }
}

// ─── Filter builder ──────────────────────────────────────────────────────────
function buildFilter(ctx, table) {
    return combineWheres(ctx?.wheres ?? [], table)
}

/**
 * OR splits the list into runs; each run is AND-ed internally. Mirrors the SQL
 * drivers' precedence so `a OR b AND c` means `a OR (b AND c)` everywhere.
 */
function combineWheres(wheres, table) {
    const runs = []
    for (const w of wheres) {
        const cond = buildWhereCondition(w, table)
        if (!cond) continue
        if (w.boolean === 'or' || !runs.length) runs.push([cond])
        else runs[runs.length - 1].push(cond)
    }
    const parts = runs.map(r => (r.length === 1 ? r[0] : { $and: r }))
    if (!parts.length) return {}
    if (parts.length === 1) return parts[0]
    return { $or: parts }
}

function buildWhereCondition(w, table) {
    const col = mapColumn(w.column, table)

    switch (w.type) {
        case 'group': {
            const sub = combineWheres(w.wheres ?? [], table)
            return Object.keys(sub).length ? sub : null
        }
        case 'not': {
            const sub = combineWheres(w.wheres ?? [], table)
            return Object.keys(sub).length ? { $nor: [sub] } : null
        }
        case 'in': return { [col]: { $in: normalizeIdValue(col, w.values ?? []) } }
        case 'notIn': return { [col]: { $nin: normalizeIdValue(col, w.values ?? []) } }
        case 'null': return { [col]: { $eq: null } }
        case 'notNull': return { [col]: { $ne: null } }
        case 'between': return { [col]: { $gte: w.min, $lte: w.max } }
        // Two ranges on one field must be OR-ed; `{$lt, $gt}` is an AND and
        // therefore unsatisfiable for any min <= max.
        case 'notBetween': return { $or: [{ [col]: { $lt: w.min } }, { [col]: { $gt: w.max } }] }
        case 'column': return { $expr: { [EXPR_OP[w.operator?.toUpperCase() ?? '='] ?? '$eq']: [`$${mapColumn(w.first, table)}`, `$${mapColumn(w.second, table)}`] } }
        case 'jsonContains': return { [col]: Array.isArray(w.value) ? { $all: w.value } : w.value }
        default: {
            const opMap = {
                '=': '$eq', '!=': '$ne', '<>': '$ne',
                '>': '$gt', '>=': '$gte',
                '<': '$lt', '<=': '$lte',
            }
            const op = w.operator?.toUpperCase()
            if (op === 'LIKE' || op === 'ILIKE') {
                return { [col]: { $regex: likeToRegExp(w.value) } }
            }
            if (op === 'NOT LIKE' || op === 'NOT ILIKE') {
                return { [col]: { $not: likeToRegExp(w.value) } }
            }
            const mongoOp = opMap[op] ?? '$eq'
            return { [col]: { [mongoOp]: normalizeIdValue(col, w.value) } }
        }
    }
}

const EXPR_OP = { '=': '$eq', '!=': '$ne', '<>': '$ne', '>': '$gt', '>=': '$gte', '<': '$lt', '<=': '$lte' }

/**
 * SQL LIKE → RegExp. Metacharacters in the *value* have to be escaped, or a
 * pattern like `whereLike('name', 'a.b')` would match 'axb'; worse, user input
 * containing `.*` or `(a|b)` would change the query's meaning.
 */
function likeToRegExp(value) {
    let out = ''
    for (const ch of String(value)) {
        if (ch === '%') out += '.*'
        else if (ch === '_') out += '.'
        else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp(`^${out}$`, 'i')
}

/**
 * `id` is the alias; `_id` is the storage. Every filter/sort/projection path
 * goes through here so the default `Model.primaryKey = 'id'` works.
 */
function mapColumn(column, table) {
    if (typeof column !== 'string') return column
    // A table-qualified column (Model.query()'s soft-delete scope emits
    // "posts.deleted_at" so it stays unambiguous across a SQL join) is
    // meaningless in Mongo — there's no join, and left as-is Mongo reads the
    // dot as a *nested* field path ("posts" sub-document that never exists),
    // silently turning the filter into a no-op instead of matching the real
    // top-level field. Only strip the prefix when it's this collection's own
    // name, so a genuine nested-field query (`where('address.city', ...)`,
    // which the README documents as supported) is untouched.
    const unqualified = (table && column.startsWith(`${table}.`)) ? column.slice(table.length + 1) : column
    return unqualified === 'id' ? '_id' : unqualified
}

// Mongo's `_id` is stored as ObjectId, but the primary-key lookup path
// (Model.find/findMany/refresh/fresh) passes the string form straight into
// where()/whereIn() — normalize it here so `{_id: {$eq: '...'}}` actually
// matches instead of silently returning nothing.
function normalizeIdValue(column, value) {
    if (column !== '_id') return value
    return Array.isArray(value) ? value.map(toObjectIdIfValid) : toObjectIdIfValid(value)
}

function buildSimpleFilter(conditions = {}) {
    const filter = {}
    for (const [k, v] of Object.entries(conditions)) {
        const col = mapColumn(k)
        filter[col] = col === '_id' ? normalizeIdValue(col, v) : v
    }
    return filter
}

function toObjectIdIfValid(v) {
    if (!v) return v
    try { return new ObjectId(String(v)) } catch { return v }
}

// ─── Document normalization ────────────────────────────────────────────────
function normalizeDoc({ _id, ...rest }) {
    const id = _id instanceof ObjectId ? _id.toString() : String(_id ?? '')
    return { ...rest, _id: id, id }
}

function prepareInsertDoc(data) {
    const { id, _id, ...rest } = data
    const doc = { ...rest }
    if (_id) {
        doc._id = toObjectIdIfValid(_id)
    } else if (id) {
        doc._id = toObjectIdIfValid(id)
    }
    return doc
}
