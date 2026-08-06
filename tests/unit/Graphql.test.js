/**
 * Unit tests — @eloquentjs/graphql
 *
 * This package had no test file at all, which is how the `categorys`
 * pluralisation, the Subscription-resolvers-without-a-Subscription-type bug, the
 * N+1 relation resolver and the broken JSON scalar all shipped.
 */

import { buildSchema } from '../../packages/graphql/src/index.js'
import { Model, setResolver, clearResolvers, EventEmitter } from '../../packages/core/src/index.js'

function makeCapturingResolver(rows = []) {
  const calls = { selects: [], aggregates: [] }
  return {
    calls,
    async select(table, ctx) { calls.selects.push({ table, ctx }); return rows },
    async aggregate(table, fn, col, ctx) { calls.aggregates.push({ table, fn, ctx }); return rows.length },
    async insert(table, data) { return { ...data, id: 1 } },
    async update() { return 1 },
    async delete() { return 1 },
    async truncate() { },
    async toSQL(table) { return { sql: `SELECT * FROM "${table}"`, params: [] } },
  }
}

class Category extends Model {
  static table = 'categories'
  static fillable = ['name']
  static timestamps = false
  static relations = { posts: { type: 'hasMany', related: 'Post' } }
  posts() { return this.hasMany(Post) }
  // A non-relation helper. It must NOT become an invoked GraphQL field.
  sendWelcomeEmail() { throw new Error('sendWelcomeEmail() must never be called by a resolver') }
}

class Post extends Model {
  static table = 'posts'
  static fillable = ['title', 'category_id']
  static timestamps = false
  static hidden = ['secret']
}

afterEach(() => { clearResolvers(); EventEmitter.flushAll() })

describe('schema generation', () => {
  test('collection query uses the shared pluraliser', () => {
    const { typeDefs, resolvers } = buildSchema([Category])
    // `singular + 's'` produced `categorys` while REST said /categories.
    expect(typeDefs).toContain('categories(')
    expect(typeDefs).not.toContain('categorys')
    expect(resolvers.Query).toHaveProperty('categories')
    expect(resolvers.Query).toHaveProperty('categoriesCount')
    expect(resolvers.Query).toHaveProperty('category')
  })

  test('CRUD mutations are generated', () => {
    const { resolvers } = buildSchema([Post])
    for (const m of ['createPost', 'updatePost', 'deletePost', 'upsertPost']) {
      expect(typeof resolvers.Mutation[m]).toBe('function')
    }
  })

  test('subscriptions: false produces neither the type nor the resolvers', () => {
    // Registering Subscription resolvers for a type absent from the SDL makes
    // most GraphQL servers throw at schema-build time.
    const { typeDefs, resolvers } = buildSchema([Post], { subscriptions: false })
    expect(typeDefs).not.toContain('type Subscription')
    expect(resolvers.Subscription).toBeUndefined()
  })

  test('subscriptions: true produces both', () => {
    const { typeDefs, resolvers } = buildSchema([Post], { subscriptions: true })
    expect(typeDefs).toContain('type Subscription')
    expect(resolvers.Subscription).toHaveProperty('postCreated')
  })

  test('hidden columns stay out of the type', () => {
    const { typeDefs } = buildSchema([Post])
    expect(typeDefs).not.toContain('secret')
  })
})

describe('relation resolvers', () => {
  test('only declared relations become fields', () => {
    const { resolvers } = buildSchema([Category])
    expect(resolvers.Category).toHaveProperty('posts')
    // Enumerating prototype methods turned this into an invoked field.
    expect(resolvers.Category).not.toHaveProperty('sendWelcomeEmail')
    expect(resolvers.Category).not.toHaveProperty('save')
  })

  test('an already-loaded relation is returned without a query', async () => {
    const resolver = makeCapturingResolver()
    setResolver(resolver)
    const { resolvers } = buildSchema([Category])

    const parent = Category._hydrate({ id: 1, name: 'a' })
    parent.setRelation('posts', ['already loaded'])

    const out = await resolvers.Category.posts(parent, {}, {}, {})
    expect(out).toEqual(['already loaded'])
    expect(resolver.calls.selects).toHaveLength(0)
  })

  test('N parents in one tick cost one query, not N', async () => {
    const resolver = makeCapturingResolver([{ id: 10, title: 't', category_id: 1 }])
    setResolver(resolver)
    const { resolvers } = buildSchema([Category])

    const parents = [1, 2, 3].map(id => Category._hydrate({ id, name: `c${id}` }))
    await Promise.all(parents.map(p => resolvers.Category.posts(p, {}, {}, {})))

    expect(resolver.calls.selects).toHaveLength(1)
    expect(resolver.calls.selects[0].table).toBe('posts')
  })
})

describe('query arguments', () => {
  test('where/orderBy/page reach the query context', async () => {
    const resolver = makeCapturingResolver()
    setResolver(resolver)
    const { resolvers } = buildSchema([Post])

    await resolvers.Query.posts(null, { where: { title: 'x' }, orderBy: 'title', orderDir: 'desc', page: 2, perPage: 5 }, {}, {})

    const ctx = resolver.calls.selects.at(-1).ctx
    expect(ctx.wheres).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'title', value: 'x' })]),
    )
    expect(ctx.orderBys).toEqual([{ column: 'title', direction: 'DESC' }])
    expect(ctx.limit).toBe(5)
    expect(ctx.offset).toBe(5)
  })

  test('an auth guard that returns nothing rejects the request', async () => {
    setResolver(makeCapturingResolver())
    const { resolvers } = buildSchema([Post], { auth: async () => null })
    await expect(resolvers.Query.posts(null, {}, {}, {})).rejects.toThrow('Unauthorized')
  })
})

describe('JSON scalar', () => {
  const scalar = () => buildSchema([Post]).resolvers.JSON

  test('parseLiteral handles object and list literals', () => {
    // JSON.parse(ast.value) is undefined for these — they have no `.value`.
    const ast = {
      kind: 'ObjectValue',
      fields: [
        { name: { value: 'a' }, value: { kind: 'IntValue', value: '1' } },
        { name: { value: 'b' }, value: { kind: 'ListValue', values: [{ kind: 'StringValue', value: 'x' }] } },
      ],
    }
    expect(scalar().parseLiteral(ast)).toEqual({ a: 1, b: ['x'] })
  })

  test('parseLiteral handles scalars and null', () => {
    const s = scalar()
    expect(s.parseLiteral({ kind: 'StringValue', value: 'hi' })).toBe('hi')
    expect(s.parseLiteral({ kind: 'FloatValue', value: '1.5' })).toBe(1.5)
    expect(s.parseLiteral({ kind: 'BooleanValue', value: true })).toBe(true)
    expect(s.parseLiteral({ kind: 'NullValue' })).toBeNull()
  })
})

describe('subscription async iterator', () => {
  const iteratorFor = model => {
    const { resolvers } = buildSchema([Post], { subscriptions: true })
    return resolvers.Subscription[model].subscribe()
  }

  test('yields events, in order', async () => {
    const it = iteratorFor('postCreated')
    await EventEmitter.emit('Post:created', { toJSON: () => ({ id: 1 }) })
    await EventEmitter.emit('Post:created', { toJSON: () => ({ id: 2 }) })

    expect(await it.next()).toEqual({ value: { id: 1 }, done: false })
    expect(await it.next()).toEqual({ value: { id: 2 }, done: false })
    await it.return()
  })

  test('two pending next() calls both resolve', async () => {
    // A single `resolve` slot meant the first waiter was dropped and its await
    // hung forever.
    const it = iteratorFor('postCreated')
    const a = it.next()
    const b = it.next()

    await EventEmitter.emit('Post:created', { toJSON: () => ({ id: 1 }) })
    await EventEmitter.emit('Post:created', { toJSON: () => ({ id: 2 }) })

    expect(await a).toEqual({ value: { id: 1 }, done: false })
    expect(await b).toEqual({ value: { id: 2 }, done: false })
    await it.return()
  })

  test('return() settles a pending next() instead of hanging', async () => {
    const it = iteratorFor('postCreated')
    const pending = it.next()
    await it.return()
    expect(await pending).toEqual({ value: undefined, done: true })
  })

  test('throw() exists and completes the iterator', async () => {
    const it = iteratorFor('postCreated')
    expect(typeof it.throw).toBe('function')
    await expect(it.throw(new Error('boom'))).rejects.toThrow('boom')
    expect(await it.next()).toEqual({ value: undefined, done: true })
  })

  test('events stop being queued after return()', async () => {
    const it = iteratorFor('postCreated')
    await it.return()
    await EventEmitter.emit('Post:created', { toJSON: () => ({ id: 9 }) })
    expect(await it.next()).toEqual({ value: undefined, done: true })
  })
})
