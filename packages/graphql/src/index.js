/**
 * @eloquentjs/graphql
 *
 * Auto-generates a full GraphQL schema + resolvers from your EloquentJS models.
 *
 * Usage:
 *   import { buildSchema } from '@eloquentjs/graphql'
 *
 *   const { typeDefs, resolvers } = buildSchema([User, Post, Comment], {
 *     subscriptions: true,    // adds real-time GraphQL subscriptions
 *     pagination: 'relay',    // 'relay' | 'offset' | 'cursor'
 *     auth: async (ctx) => ctx.user,  // optional auth guard
 *   })
 *
 *   // Use with Apollo Server, Yoga, Mercurius, etc.
 *   const server = new ApolloServer({ typeDefs, resolvers })
 *
 * Per-model customization:
 *   class User extends Model {
 *     static graphql = {
 *       fields: { password: false },         // hide field
 *       queries: { deleteUser: false },       // disable query/mutation
 *       subscription: true,                   // enable subscriptions
 *       middleware: [authRequired, logQuery], // per-resolver middleware
 *     }
 *   }
 */

import { EventEmitter } from '@eloquentjs/core'

const typeMap = {
  integer: 'Int',
  biginteger: 'Int',
  float: 'Float',
  double: 'Float',
  decimal: 'Float',
  string: 'String',
  text: 'String',
  boolean: 'Boolean',
  date: 'String',
  datetime: 'String',
  timestamp: 'String',
  json: 'JSON',
  jsonb: 'JSON',
  uuid: 'ID',
}

export function buildSchema(models, options = {}) {
  const {
    pagination = 'offset',   // 'offset' | 'relay' | 'cursor'
    subscriptions = true,
    auth = null,
    scalars = [],
  } = options

  const typeDefsArr = [
    `scalar JSON`,
    `scalar Upload`,
    `scalar DateTime`,
    ...scalars.map(s => `scalar ${s}`),

    // Pagination types
    `type PageInfo { hasNextPage: Boolean! hasPreviousPage: Boolean! startCursor: String endCursor: String }`,
    `type PaginationMeta { total: Int! perPage: Int! currentPage: Int! lastPage: Int! hasMore: Boolean! }`,
  ]

  const queryFields = []
  const mutationFields = []
  const subscriptionFields = []
  const resolvers = { Query: {}, Mutation: {}, Subscription: {}, JSON: jsonScalar(), DateTime: dateTimeScalar() }

  for (const ModelClass of models) {
    const name = ModelClass.name
    const graphqlConfig = ModelClass.graphql ?? {}
    const hiddenFields = new Set(graphqlConfig.fields
      ? Object.entries(graphqlConfig.fields).filter(([, v]) => v === false).map(([k]) => k)
      : ModelClass.hidden ?? []
    )

    // ── Type definition ───────────────────────────────────────────────────────
    const fields = inferFields(ModelClass, hiddenFields)
    const fieldsDef = fields.map(f => `  ${f.name}: ${f.gqlType}`).join('\n')
    typeDefsArr.push(`type ${name} {\n${fieldsDef}\n}`)

    // Input types
    const inputFields = fields.filter(f => f.name !== 'id' && f.name !== '_id' && !f.name.endsWith('_at'))
    typeDefsArr.push(`input Create${name}Input {\n${inputFields.map(f => `  ${f.name}: ${f.gqlType.replace('!', '')}`).join('\n')}\n}`)
    typeDefsArr.push(`input Update${name}Input {\n${inputFields.map(f => `  ${f.name}: ${f.gqlType.replace('!', '')}`).join('\n')}\n}`)
    typeDefsArr.push(`input ${name}WhereInput { AND: [${name}WhereInput] OR: [${name}WhereInput] ${fields.map(f => `${f.name}: ${f.gqlType.replace('!', '')}`).join(' ')} }`)

    // Pagination connection type (Relay)
    if (pagination === 'relay') {
      typeDefsArr.push(`type ${name}Edge { node: ${name}! cursor: String! }`)
      typeDefsArr.push(`type ${name}Connection { edges: [${name}Edge!]! pageInfo: PageInfo! totalCount: Int! }`)
    } else {
      typeDefsArr.push(`type ${name}Page { data: [${name}!]! meta: PaginationMeta! }`)
    }

    // ── Queries ───────────────────────────────────────────────────────────────
    const singular = toLower(name)
    const plural   = singular + 's'

    queryFields.push(`  ${singular}(id: ID!): ${name}`)
    queryFields.push(`  ${plural}(where: ${name}WhereInput, orderBy: String, orderDir: String, page: Int, perPage: Int): ${name}Page`)
    queryFields.push(`  ${plural}Count(where: ${name}WhereInput): Int!`)

    // ── Mutations ─────────────────────────────────────────────────────────────
    mutationFields.push(`  create${name}(input: Create${name}Input!): ${name}!`)
    mutationFields.push(`  update${name}(id: ID!, input: Update${name}Input!): ${name}!`)
    mutationFields.push(`  delete${name}(id: ID!): Boolean!`)
    if (ModelClass.softDeletes) {
      mutationFields.push(`  restore${name}(id: ID!): ${name}!`)
      mutationFields.push(`  forceDelete${name}(id: ID!): Boolean!`)
    }
    mutationFields.push(`  upsert${name}(where: ${name}WhereInput!, input: Create${name}Input!): ${name}!`)

    // ── Subscriptions ─────────────────────────────────────────────────────────
    if (subscriptions && graphqlConfig.subscription !== false) {
      subscriptionFields.push(`  ${singular}Created: ${name}!`)
      subscriptionFields.push(`  ${singular}Updated: ${name}!`)
      subscriptionFields.push(`  ${singular}Deleted: ID!`)
    }

    // ── Resolvers ─────────────────────────────────────────────────────────────
    const middleware = graphqlConfig.middleware ?? []
    const guard = makeGuard(auth, middleware)

    resolvers.Query[singular] = guard(async (_, { id }, ctx) => {
      return ModelClass.find(id)
    })

    resolvers.Query[plural] = guard(async (_, { where, orderBy, orderDir, page = 1, perPage = 15 }, ctx) => {
      let qb = ModelClass.query()
      if (where) applyWhereInput(qb, where)
      if (orderBy) qb = qb.orderBy(orderBy, orderDir ?? 'asc')
      return qb.paginate(page, perPage)
    })

    resolvers.Query[`${plural}Count`] = guard(async (_, { where }, ctx) => {
      let qb = ModelClass.query()
      if (where) applyWhereInput(qb, where)
      return qb.count()
    })

    resolvers.Mutation[`create${name}`] = guard(async (_, { input }, ctx) => {
      return ModelClass.create(input)
    })

    resolvers.Mutation[`update${name}`] = guard(async (_, { id, input }, ctx) => {
      const model = await ModelClass.findOrFail(id)
      await model.update(input)
      return model
    })

    resolvers.Mutation[`delete${name}`] = guard(async (_, { id }, ctx) => {
      const model = await ModelClass.findOrFail(id)
      await model.delete()
      return true
    })

    resolvers.Mutation[`upsert${name}`] = guard(async (_, { where, input }, ctx) => {
      return ModelClass.updateOrCreate(where, input)
    })

    if (ModelClass.softDeletes) {
      resolvers.Mutation[`restore${name}`] = guard(async (_, { id }) => {
        const model = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).firstOrFail()
        await model.restore()
        return model
      })

      resolvers.Mutation[`forceDelete${name}`] = guard(async (_, { id }) => {
        const model = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).firstOrFail()
        await model.forceDelete()
        return true
      })
    }

    // Subscription resolvers
    if (subscriptions && graphqlConfig.subscription !== false) {
      resolvers.Subscription ??= {}
      resolvers.Subscription[`${singular}Created`] = {
        subscribe: () => createAsyncIterator(`${name}:created`),
        resolve: (payload) => payload,
      }
      resolvers.Subscription[`${singular}Updated`] = {
        subscribe: () => createAsyncIterator(`${name}:updated`),
        resolve: (payload) => payload,
      }
      resolvers.Subscription[`${singular}Deleted`] = {
        subscribe: () => createAsyncIterator(`${name}:deleted`),
        resolve: (payload) => payload[ModelClass.primaryKey],
      }
    }

    // Type-level relation resolvers
    resolvers[name] = buildRelationResolvers(ModelClass, guard)
  }

  // Assemble SDL
  const typeDefs = [
    ...typeDefsArr,
    `type Query {\n${queryFields.join('\n')}\n}`,
    `type Mutation {\n${mutationFields.join('\n')}\n}`,
    subscriptionFields.length ? `type Subscription {\n${subscriptionFields.join('\n')}\n}` : '',
  ].filter(Boolean).join('\n\n')

  return { typeDefs, resolvers }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function inferFields(ModelClass, hiddenFields) {
  const casts = ModelClass.casts ?? {}
  const fields = [{ name: 'id', gqlType: 'ID!' }]

  const castToGql = (cast) => {
    if (!cast) return 'String'
    if (cast === 'integer' || cast === 'int') return 'Int'
    if (cast === 'float' || cast === 'double' || cast.startsWith('decimal')) return 'Float'
    if (cast === 'boolean' || cast === 'bool') return 'Boolean'
    if (cast === 'json' || cast === 'array' || cast === 'object') return 'JSON'
    if (cast === 'date' || cast === 'datetime' || cast === 'timestamp') return 'DateTime'
    return 'String'
  }

  for (const [key, cast] of Object.entries(casts)) {
    if (hiddenFields.has(key) || key === 'id') continue
    fields.push({ name: key, gqlType: castToGql(cast) })
  }

  if (ModelClass.timestamps) {
    fields.push({ name: 'created_at', gqlType: 'DateTime' })
    fields.push({ name: 'updated_at', gqlType: 'DateTime' })
  }
  if (ModelClass.softDeletes) {
    fields.push({ name: 'deleted_at', gqlType: 'DateTime' })
  }

  return fields.filter(f => !hiddenFields.has(f.name))
}

function buildRelationResolvers(ModelClass, guard) {
  const resolvers = {}
  const proto = ModelClass.prototype

  const knownRelations = Object.getOwnPropertyNames(proto).filter(name => {
    if (name === 'constructor' || name.startsWith('_') || name.startsWith('get') || name.startsWith('set')) return false
    return true
  })

  for (const relName of knownRelations) {
    resolvers[relName] = guard(async (parent) => {
      if (parent.relationLoaded(relName)) return parent.getRelation(relName)
      try {
        const rel = parent[relName]?.()
        return rel ? await rel : undefined
      } catch { return undefined }
    })
  }

  return resolvers
}

function applyWhereInput(qb, where) {
  if (where.AND) for (const sub of where.AND) applyWhereInput(qb, sub)
  if (where.OR)  { /* TODO: wrap in orWhere group */ }

  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || value == null) continue
    qb.where(key, value)
  }
}

function makeGuard(auth, middleware) {
  return (resolver) => async (parent, args, ctx, info) => {
    if (auth) {
      const user = await auth(ctx)
      if (!user) throw new Error('Unauthorized')
      ctx.user = user
    }
    let result = resolver
    for (const mw of middleware) {
      const next = result
      result = (p, a, c, i) => mw(p, a, c, i, () => next(p, a, c, i))
    }
    return result(parent, args, ctx, info)
  }
}

function createAsyncIterator(event) {
  const queue = []
  let resolve = null

  const unsub = EventEmitter.on(event, (model) => {
    const data = model?.toJSON?.() ?? model
    if (resolve) { resolve({ value: { [event]: data }, done: false }); resolve = null }
    else queue.push(data)
  })

  return {
    [Symbol.asyncIterator]() { return this },
    next() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false })
      return new Promise(r => { resolve = r })
    },
    return() { unsub(); return Promise.resolve({ value: undefined, done: true }) },
  }
}

function toLower(str) { return str[0].toLowerCase() + str.slice(1) }

function jsonScalar() {
  return {
    serialize: v => v,
    parseValue: v => v,
    parseLiteral: ast => JSON.parse(ast.value),
  }
}

function dateTimeScalar() {
  return {
    serialize: v => v instanceof Date ? v.toISOString() : v,
    parseValue: v => new Date(v),
    parseLiteral: ast => new Date(ast.value),
  }
}
