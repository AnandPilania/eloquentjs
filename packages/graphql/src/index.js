/**
 * @eloquentjs/graphql
 *
 * Auto-generates a full GraphQL schema + resolvers from your EloquentJS models.
 * SDL generation is powered by @eloquentjs/codegen.
 *
 * Pagination: offset-based only (page + perPage). Cursor-based pagination is
 * not yet implemented — use the paginate() resolver and PaginationMeta type.
 */

import { EventEmitter, toSnakePlural, toCamelCase } from '@eloquentjs/core'
import { introspect } from '@eloquentjs/codegen/introspect'
import { generateGraphqlSDL } from '@eloquentjs/codegen/templates'

/**
 * The field name for a model's collection query. Uses core's pluraliser so
 * GraphQL, REST routes, table names and WebSocket channels all agree —
 * `singular + 's'` gave `categorys` while REST said `categories`.
 */
function pluralField(name) {
    return toCamelCase(toSnakePlural(name))
}

export { buildSchema, buildSchemaFromDir }

function buildSchema(models, options = {}) {
    const { subscriptions = true, auth = null, scalars = [] } = options

    const preamble = [
        'scalar JSON', 'scalar Upload', 'scalar DateTime',
        ...scalars.map(s => `scalar ${s}`),
        `type PaginationMeta { total: Int! perPage: Int! currentPage: Int! lastPage: Int! hasMore: Boolean! }`,
    ]

    const typeDefsArr = [...preamble]
    const allQuery = [], allMutation = [], allSubscription = []
    const resolvers = { Query: {}, Mutation: {}, Subscription: {}, JSON: jsonScalar(), DateTime: dateTimeScalar() }
    const knownTypes = new Set(models.map(m => m.name))

    for (const ModelClass of models) {
        const schema = introspect(ModelClass)
        const sdl = generateGraphqlSDL(schema, { subscriptions, knownTypes })
        typeDefsArr.push(sdl.typeDef, sdl.inputCreate, sdl.inputUpdate, sdl.inputWhere, sdl.paginated)
        allQuery.push(...sdl.queryLines)
        allMutation.push(...sdl.mutationLines)
        allSubscription.push(...sdl.subscriptionLines)
        buildResolvers(resolvers, schema, ModelClass, { auth, subscriptions })
    }

    // An empty Subscription resolver map with no Subscription type in the SDL
    // makes most servers throw, so drop it when there are no subscriptions.
    if (!allSubscription.length) delete resolvers.Subscription

    const typeDefs = [
        ...typeDefsArr,
        `type Query {\n${allQuery.join('\n')}\n}`,
        allMutation.length ? `type Mutation {\n${allMutation.join('\n')}\n}` : '',
        allSubscription.length ? `type Subscription {\n${allSubscription.join('\n')}\n}` : '',
    ].filter(Boolean).join('\n\n')

    return { typeDefs, resolvers }
}

async function buildSchemaFromDir(modelsDir, options = {}) {
    const { loadModelsFromDir } = await import('@eloquentjs/codegen/render')
    const models = await loadModelsFromDir(modelsDir)
    return buildSchema(models, options)
}

function buildResolvers(resolvers, schema, ModelClass, { auth, subscriptions }) {
    const { name, softDeletes, graphql: gql } = schema
    const singular = name[0].toLowerCase() + name.slice(1)
    const plural = pluralField(name)
    const guard = makeGuard(auth, gql.middleware)

    resolvers.Query[singular] = guard(async (_, { id }) => ModelClass.find(id))
    resolvers.Query[plural] = guard(async (_, { where, orderBy, orderDir, page = 1, perPage = 15 }) => {
        let qb = ModelClass.query()
        if (where) applyWhere(qb, where)
        if (orderBy) qb = qb.orderBy(orderBy, orderDir ?? 'asc')
        return qb.paginate(page, perPage)
    })
    resolvers.Query[`${plural}Count`] = guard(async (_, { where }) => {
        const qb = ModelClass.query()
        if (where) applyWhere(qb, where)
        return qb.count()
    })
    resolvers.Mutation[`create${name}`] = guard(async (_, { input }) => ModelClass.create(input))
    resolvers.Mutation[`update${name}`] = guard(async (_, { id, input }) => {
        const m = await ModelClass.findOrFail(id); await m.update(input); return m
    })
    resolvers.Mutation[`delete${name}`] = guard(async (_, { id }) => {
        const m = await ModelClass.findOrFail(id); await m.delete(); return true
    })
    resolvers.Mutation[`upsert${name}`] = guard(async (_, { where, input }) => ModelClass.updateOrCreate(where, input))
    if (softDeletes) {
        resolvers.Mutation[`restore${name}`] = guard(async (_, { id }) => {
            const m = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).firstOrFail()
            await m.restore(); return m
        })
        resolvers.Mutation[`forceDelete${name}`] = guard(async (_, { id }) => {
            const m = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).firstOrFail()
            await m.forceDelete(); return true
        })
    }
    // Gated on the same flag that decides whether the SDL has a Subscription
    // type — these used to be registered whenever gql.subscription !== false,
    // even with buildSchema(models, {subscriptions: false}).
    if (subscriptions && gql.subscription !== false) {
        resolvers.Subscription[`${singular}Created`] = { subscribe: () => createAsyncIterator(`${name}:created`), resolve: p => p }
        resolvers.Subscription[`${singular}Updated`] = { subscribe: () => createAsyncIterator(`${name}:updated`), resolve: p => p }
        resolvers.Subscription[`${singular}Deleted`] = { subscribe: () => createAsyncIterator(`${name}:deleted`), resolve: p => p[ModelClass.primaryKey] }
    }
    resolvers[name] = buildRelationResolvers(ModelClass, guard, schema)
}

/**
 * Relation field resolvers.
 *
 * Two things this deliberately does NOT do any more:
 *  - Enumerate and *call* every own prototype method. A helper like
 *    `sendWelcomeEmail()` became an invoked GraphQL field. The relation list
 *    now comes from introspection (`schema.relations`), which reads the
 *    declared relations.
 *  - Resolve one query per parent row. Requests are batched per tick, so a
 *    list of N parents costs one query per relation, not N.
 */
function buildRelationResolvers(ModelClass, guard, schema) {
    const result = {}
    for (const { name: rel } of schema.relations ?? []) {
        result[rel] = guard(async (parent) => {
            if (parent.relationLoaded?.(rel)) return parent.getRelation?.(rel)
            return batchLoad(ModelClass, rel, parent)
        })
    }
    return result
}

/**
 * Per-tick batching, the DataLoader pattern without the dependency: parents
 * asking for the same relation in the same tick are eager-loaded together.
 * @type {Map<string, {parents: any[], promise: Promise<void>}>}
 */
const _batches = new Map()

function batchLoad(ModelClass, relation, parent) {
    const key = `${ModelClass.name}::${relation}`
    let batch = _batches.get(key)

    if (!batch) {
        const parents = []
        /** @type {Promise<void>} */
        const promise = new Promise(resolve => {
            // queueMicrotask runs after the current synchronous field-resolution
            // pass, by which point every parent for this tick has enlisted.
            queueMicrotask(async () => {
                _batches.delete(key)
                try {
                    await ModelClass.query()._eagerLoad(parents, [relation])
                } catch {
                    for (const p of parents) p.setRelation?.(relation, null)
                }
                resolve()
            })
        })
        batch = { parents, promise }
        _batches.set(key, batch)
    }

    batch.parents.push(parent)
    return batch.promise.then(() => parent.getRelation?.(relation) ?? null)
}

function applyWhere(qb, where) {
    if (where.AND) {
        for (const sub of where.AND) applyWhere(qb, sub)
    }
    if (where.OR && where.OR.length > 0) {
        qb.where(subQb => {
            for (const sub of where.OR) {
                subQb.orWhere(innerQb => applyWhere(innerQb, sub))
            }
        })
    }
    for (const [key, value] of Object.entries(where)) {
        if (key === 'AND' || key === 'OR' || value == null) continue
        qb.where(key, value)
    }
}

function makeGuard(auth, middleware = []) {
    return (resolver) => async (parent, args, ctx, info) => {
        if (auth) { const user = await auth(ctx); if (!user) throw new Error('Unauthorized'); ctx.user = user }
        let fn = resolver
        for (const mw of middleware) { const next = fn; fn = (p, a, c, i) => mw(p, a, c, i, () => next(p, a, c, i)) }
        return fn(parent, args, ctx, info)
    }
}

/**
 * A conforming async iterator over an event.
 * The previous version dropped a consumer if next() was called twice before an
 * event (a single `resolve` slot), never settled a pending next() on return(),
 * omitted throw(), and let the queue grow without bound.
 *
 * @param {string} event
 * @param {number} maxQueue oldest events are dropped past this many
 */
function createAsyncIterator(event, maxQueue = 1000) {
    /** @type {any[]} */
    const queue = []
    /** @type {((r: {value: any, done: boolean}) => void)[]} */
    const pending = []
    let done = false

    const unsub = EventEmitter.on(event, model => {
        if (done) return
        const data = model?.toJSON?.() ?? model
        const waiter = pending.shift()
        if (waiter) return waiter({ value: data, done: false })
        queue.push(data)
        if (queue.length > maxQueue) queue.shift()
    })

    const finish = () => {
        if (done) return
        done = true
        unsub()
        // Settle everyone still waiting, or their awaits hang forever.
        while (pending.length) pending.shift()({ value: undefined, done: true })
    }

    return {
        [Symbol.asyncIterator]() { return this },
        next() {
            if (queue.length) return Promise.resolve({ value: queue.shift(), done: false })
            if (done) return Promise.resolve({ value: undefined, done: true })
            return new Promise(resolve => pending.push(resolve))
        },
        return() {
            finish()
            return Promise.resolve({ value: undefined, done: true })
        },
        throw(err) {
            finish()
            return Promise.reject(err)
        },
    }
}

/**
 * JSON scalar. parseLiteral has to walk the AST: `JSON.parse(ast.value)` is
 * undefined for object and list literals, which have no `.value`.
 */
function jsonScalar() {
    const parseAst = ast => {
        switch (ast.kind) {
            case 'IntValue': return parseInt(ast.value, 10)
            case 'FloatValue': return parseFloat(ast.value)
            case 'BooleanValue': return ast.value
            case 'StringValue': return ast.value
            case 'EnumValue': return ast.value
            case 'NullValue': return null
            case 'ListValue': return ast.values.map(parseAst)
            case 'ObjectValue':
                return Object.fromEntries(ast.fields.map(f => [f.name.value, parseAst(f.value)]))
            default: return null
        }
    }
    return { serialize: v => v, parseValue: v => v, parseLiteral: parseAst }
}
function dateTimeScalar() { return { serialize: v => v instanceof Date ? v.toISOString() : v, parseValue: v => new Date(v), parseLiteral: ast => new Date(ast.value) } }
