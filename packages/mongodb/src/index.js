/**
 * @eloquentjs/mongodb — MongoDB Driver
 *
 * Translates the QueryBuilder context into MongoDB filter/pipeline objects.
 * Primary key is always normalized to both `_id` (ObjectId) and `id` (string).
 *
 * Supports multiple named connections via a Map — mirrors the PgSQL driver.
 */

import { MongoClient, ObjectId } from 'mongodb'
import { setResolver } from '@eloquentjs/core'

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
export async function connect({ url, database, ...options } = {}, connectionName = 'default') {
    // Close existing connection for this name before replacing it
    if (_clients.has(connectionName)) {
        await _clients.get(connectionName).close().catch(() => { })
        _clients.delete(connectionName)
        _dbs.delete(connectionName)
    }

    const client = new MongoClient(url, { ...options })
    await client.connect()
    const db = client.db(database)

    _clients.set(connectionName, client)
    _dbs.set(connectionName, db)

    const resolver = new MongoResolver(db, connectionName)
    setResolver(resolver, connectionName)
    return resolver
}

/** Returns the raw mongodb.Db for the named connection (for advanced use). */
export function getDb(connectionName = 'default') {
    return _getDb(connectionName)
}

/** Disconnect and remove the named connection (or all if name omitted). */
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

/** Run a function inside a MongoDB session transaction. Rolls back on throw. */
export async function transaction(callback, connectionName = 'default') {
    const session = _getClient(connectionName).startSession()
    try {
        session.startTransaction()
        const result = await callback(session)
        await session.commitTransaction()
        return result
    } catch (err) {
        await session.abortTransaction()
        throw err
    } finally {
        session.endSession()
    }
}

// ─── MongoResolver ───────────────────────────────────────────────────────────
export class MongoResolver {
    constructor(db, connectionName = 'default') {
        this._db = db
        this._connectionName = connectionName
    }

    _col(table) { return this._db.collection(table) }

    async select(table, ctx) {
        const filter = buildFilter(ctx)
        let cursor = this._col(table).find(filter)

        // Projection
        const selects = ctx.selects ?? ['*']
        if (selects.length && selects[0] !== '*' && !selects[0]?.raw) {
            const proj = {}
            for (const s of selects) proj[s] = 1
            cursor = cursor.project(proj)
        }

        // Sort — combine all orderBys
        if (ctx.orderBys?.length) {
            const sort = {}
            for (const o of ctx.orderBys) {
                if (o.random) continue
                if (o.raw) continue
                sort[o.column] = o.direction === 'DESC' ? -1 : 1
            }
            if (Object.keys(sort).length) cursor = cursor.sort(sort)
        }

        if (ctx.offset) cursor = cursor.skip(ctx.offset)
        if (ctx.limit) cursor = cursor.limit(ctx.limit)

        const docs = await cursor.toArray()
        return docs.map(normalizeDoc)
    }

    async insert(table, data) {
        const doc = prepareInsertDoc(data)
        const result = await this._col(table).insertOne(doc)
        const id = result.insertedId.toString()
        return { ...normalizeDoc(doc), id, _id: id, insertedId: result.insertedId }
    }

    async insertMany(table, rows) {
        if (!Array.isArray(rows) || !rows.length) return []
        const docs = rows.map(prepareInsertDoc)
        const result = await this._col(table).insertMany(docs)
        return docs.map((doc, i) => normalizeDoc({ ...doc, _id: doc._id ?? result.insertedIds[i] }))
    }

    async update(table, conditions, data, ctx = null) {
        const filter = ctx ? buildFilter(ctx) : buildSimpleFilter(conditions)
        // Remove undefined values
        const $set = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
        if (!Object.keys($set).length) return 0
        const result = await this._col(table).updateMany(filter, { $set })
        return result.modifiedCount
    }

    async delete(table, conditions, ctx = null) {
        const filter = ctx ? buildFilter(ctx) : buildSimpleFilter(conditions)
        const result = await this._col(table).deleteMany(filter)
        return result.deletedCount
    }

    async aggregate(table, fn, column, ctx) {
        const match = buildFilter(ctx)
        const aggMap = {
            count: { $sum: 1 },
            sum: { $sum: `$${column}` },
            avg: { $avg: `$${column}` },
            max: { $max: `$${column}` },
            min: { $min: `$${column}` },
        }
        const pipeline = [
            { $match: match },
            { $group: { _id: null, _result: aggMap[fn] } },
        ]
        const rows = await this._col(table).aggregate(pipeline).toArray()
        const val = rows[0]?._result
        return val == null ? (fn === 'count' ? 0 : null) : val
    }

    async increment(table, column, amount, extra, ctx) {
        const filter = buildFilter(ctx)
        const update = { $inc: { [column]: amount } }
        if (extra && Object.keys(extra).length) update.$set = extra
        const result = await this._col(table).updateMany(filter, update)
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
        const throughs = await this._col(throughTable).find({ [firstKey]: toObjectIdIfValid(parentId) }).toArray()
        const throughIds = throughs.map(t => t._id)
        const docs = await this._col(relatedTable).find({ [secondKey]: { $in: throughIds } }).toArray()
        return docs.map(normalizeDoc)
    }

    async hasManyThroughMany({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentIds }) {
        const throughs = await this._col(throughTable).find({ [firstKey]: { $in: parentIds.map(toObjectIdIfValid) } }).toArray()
        const parentMap = {}
        for (const t of throughs) parentMap[t._id.toString()] = t[firstKey]

        const throughIds = throughs.map(t => t._id)
        const docs = await this._col(relatedTable).find({ [secondKey]: { $in: throughIds } }).toArray()
        return docs.map(doc => ({
            ...normalizeDoc(doc),
            _parent_id: parentMap[doc[secondKey]?.toString()],
        }))
    }

    async toSQL(table, ctx) {
        return { collection: table, filter: buildFilter(ctx) }
    }

    async truncate(table) {
        await this._col(table).deleteMany({})
    }

    // ── DDL (MongoDB = schemaless, but we support indexes) ──────────────────────
    async createTable(table, blueprint) {
        try { await this._db.createCollection(table) } catch { }
        const col = this._col(table)
        for (const idx of blueprint.indexes) {
            if (idx.type === 'dropIndex' || idx.type === 'dropUnique') continue
            const keys = Object.fromEntries(idx.columns.map(c => [c, 1]))
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
            const keys = Object.fromEntries(idx.columns.map(c => [c, 1]))
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

    async hasColumn() { return true } // schemaless

    async getColumnListing(table) {
        const doc = await this._col(table).findOne()
        return doc ? Object.keys(doc) : []
    }
}

// ─── Filter builder ──────────────────────────────────────────────────────────
function buildFilter(ctx) {
    return combineWheres(ctx?.wheres ?? [])
}

/**
 * OR splits the list into runs; each run is AND-ed internally. Mirrors the SQL
 * drivers' precedence so `a OR b AND c` means `a OR (b AND c)` everywhere.
 */
function combineWheres(wheres) {
    const runs = []
    for (const w of wheres) {
        const cond = buildWhereCondition(w)
        if (!cond) continue
        if (w.boolean === 'or' || !runs.length) runs.push([cond])
        else runs[runs.length - 1].push(cond)
    }
    const parts = runs.map(r => (r.length === 1 ? r[0] : { $and: r }))
    if (!parts.length) return {}
    if (parts.length === 1) return parts[0]
    return { $or: parts }
}

function buildWhereCondition(w) {
    switch (w.type) {
        case 'group': {
            const sub = combineWheres(w.wheres ?? [])
            return Object.keys(sub).length ? sub : null
        }
        case 'in': return { [w.column]: { $in: w.values ?? [] } }
        case 'notIn': return { [w.column]: { $nin: w.values ?? [] } }
        case 'null': return { [w.column]: { $eq: null } }
        case 'notNull': return { [w.column]: { $ne: null } }
        case 'between': return { [w.column]: { $gte: w.min, $lte: w.max } }
        case 'notBetween': return { [w.column]: { $lt: w.min, $gt: w.max } }
        case 'jsonContains': return { [w.column]: Array.isArray(w.value) ? { $all: w.value } : w.value }
        default: {
            const opMap = {
                '=': '$eq', '!=': '$ne', '<>': '$ne',
                '>': '$gt', '>=': '$gte',
                '<': '$lt', '<=': '$lte',
                'LIKE': null,  // handled below
                'NOT LIKE': null,
                'ILIKE': null,
            }
            const op = w.operator?.toUpperCase()
            if (op === 'LIKE' || op === 'ILIKE') {
                const pattern = w.value.replace(/%/g, '.*').replace(/_/g, '.')
                return { [w.column]: { $regex: new RegExp(`^${pattern}$`, 'i') } }
            }
            if (op === 'NOT LIKE') {
                const pattern = w.value.replace(/%/g, '.*').replace(/_/g, '.')
                return { [w.column]: { $not: new RegExp(`^${pattern}$`, 'i') } }
            }
            const mongoOp = opMap[op] ?? '$eq'
            return { [w.column]: { [mongoOp]: w.value } }
        }
    }
}

function buildSimpleFilter(conditions = {}) {
    const filter = {}
    for (const [k, v] of Object.entries(conditions)) {
        filter[k] = k === '_id' && typeof v === 'string' ? toObjectIdIfValid(v) : v
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
