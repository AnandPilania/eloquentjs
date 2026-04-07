/**
 * @eloquentjs/graphql
 *
 * Auto-generates a full GraphQL schema + resolvers from your EloquentJS models.
 * SDL generation is powered by @eloquentjs/codegen.
 *
 * Pagination: offset-based only (page + perPage). Cursor-based pagination is
 * not yet implemented — use the paginate() resolver and PaginationMeta type.
 */

import { EventEmitter } from '@eloquentjs/core'
import { introspect } from '@eloquentjs/codegen/introspect'
import { generateGraphqlSDL } from '@eloquentjs/codegen/templates'

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

    for (const ModelClass of models) {
        const schema = introspect(ModelClass)
        const sdl = generateGraphqlSDL(schema, { subscriptions })
        typeDefsArr.push(sdl.typeDef, sdl.inputCreate, sdl.inputUpdate, sdl.inputWhere, sdl.paginated)
        allQuery.push(...sdl.queryLines)
        allMutation.push(...sdl.mutationLines)
        allSubscription.push(...sdl.subscriptionLines)
        buildResolvers(resolvers, schema, ModelClass, { auth })
    }

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

function buildResolvers(resolvers, schema, ModelClass, { auth }) {
    const { name, softDeletes, graphql: gql } = schema
    const singular = name[0].toLowerCase() + name.slice(1)
    const plural = singular + 's'
    const guard = makeGuard(auth, gql.middleware)

    resolvers.Query[singular] = guard(async (_, { id }) => ModelClass.find(id))
    resolvers.Query[plural] = guard(async (_, { where, orderBy, orderDir, page = 1, perPage = 15 }) => {
        let qb = ModelClass.query()
        if (where) applyWhere(qb, where)
        if (orderBy) qb = qb.orderBy(orderBy, orderDir ?? 'asc')
        return qb.paginate(page, perPage)
    })
    resolvers.Query[`${plural}Count`] = guard(async (_, { where }) => {
        let qb = ModelClass.query()
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
    if (gql.subscription !== false) {
        resolvers.Subscription[`${singular}Created`] = { subscribe: () => createAsyncIterator(`${name}:created`), resolve: p => p }
        resolvers.Subscription[`${singular}Updated`] = { subscribe: () => createAsyncIterator(`${name}:updated`), resolve: p => p }
        resolvers.Subscription[`${singular}Deleted`] = { subscribe: () => createAsyncIterator(`${name}:deleted`), resolve: p => p[ModelClass.primaryKey] }
    }
    resolvers[name] = buildRelationResolvers(ModelClass, guard)
}

function buildRelationResolvers(ModelClass, guard) {
    const result = {}
    const proto = ModelClass.prototype
    for (const rel of Object.getOwnPropertyNames(proto)) {
        if (rel === 'constructor' || rel.startsWith('_') || rel.startsWith('get') || rel.startsWith('set') || rel.startsWith('scope')) continue
        if (typeof proto[rel] !== 'function') continue
        result[rel] = guard(async (parent) => {
            if (parent.relationLoaded?.(rel)) return parent.getRelation?.(rel)
            try { return await parent[rel]?.() } catch { return null }
        })
    }
    return result
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

function createAsyncIterator(event) {
    const queue = []; let resolve = null
    const unsub = EventEmitter.on(event, model => {
        const data = model?.toJSON?.() ?? model
        if (resolve) { resolve({ value: data, done: false }); resolve = null } else queue.push(data)
    })
    return {
        [Symbol.asyncIterator]() { return this },
        next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); return new Promise(r => { resolve = r }) },
        return() { unsub(); return Promise.resolve({ value: undefined, done: true }) },
    }
}
function jsonScalar() { return { serialize: v => v, parseValue: v => v, parseLiteral: ast => JSON.parse(ast.value) } }
function dateTimeScalar() { return { serialize: v => v instanceof Date ? v.toISOString() : v, parseValue: v => new Date(v), parseLiteral: ast => new Date(ast.value) } }
