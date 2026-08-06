/**
 * Unit tests — @eloquentjs/api (Express path)
 *
 * Drives apiRouter() with a fake req/res and a capturing resolver, so the
 * QueryBuilder context the router built can be inspected directly. Covers the
 * ?search= closure and the opt-in ?column=value filter allowlist.
 */

import { apiRouter, resource } from '../../packages/api/src/index.js'
import { Model } from '../../packages/core/src/Model.js'
import { setResolver, clearResolvers } from '../../packages/core/src/ConnectionRegistry.js'

function makeCapturingResolver() {
  const calls = { selects: [], aggregates: [] }
  return {
    calls,
    async select(table, ctx)             { calls.selects.push({ table, ctx }); return [] },
    async aggregate(table, fn, col, ctx) { calls.aggregates.push({ fn, ctx }); return 0 },
    async insert(table, data)            { return { ...data, id: 1 } },
    async update()                       { return 1 },
    async delete()                       { return 1 },
    async toSQL(table)                   { return { sql: `SELECT * FROM "${table}"`, params: [] } },
  }
}

class User extends Model {
  static table      = 'users'
  static fillable   = ['name', 'email']
  static hidden     = ['password']
  static timestamps = false
}

let resolver

beforeEach(() => {
  resolver = makeCapturingResolver()
  clearResolvers()
  setResolver(resolver)
})

afterEach(() => clearResolvers())

// Run GET /users?<query> through the router and return the select context.
async function index(query, options = {}) {
  const router = apiRouter([resource(User, options)])
  const req = { path: '/users', method: 'GET', query, params: {}, body: {} }
  await new Promise((done, fail) => {
    // The router ends the request via res.json/res.end and only calls next()
    // when nothing matched — settle on whichever happens.
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; done(); return this },
      end() { done(); return this },
    }
    router(req, res, (err) => (err ? fail(err) : done()))
  })
  return resolver.calls.selects.at(-1)?.ctx
}

describe('GET index — search', () => {
  test('?search= builds one OR group across searchable columns', async () => {
    const ctx = await index({ search: 'ali' }, { searchable: ['name', 'email'] })
    const group = ctx.wheres.find(w => w.type === 'group')
    expect(group).toBeDefined()
    expect(group.wheres.map(w => w.column)).toEqual(['name', 'email'])
    expect(group.wheres.every(w => w.operator === 'LIKE')).toBe(true)
    expect(group.wheres.every(w => w.value === '%ali%')).toBe(true)
  })

  test('search is ignored when no searchable columns are declared', async () => {
    const ctx = await index({ search: 'ali' }, {})
    expect(ctx.wheres).toHaveLength(0)
  })

  test('no ?search= means no group', async () => {
    const ctx = await index({}, { searchable: ['name'] })
    expect(ctx.wheres).toHaveLength(0)
  })
})

describe('GET index — filters are opt-in', () => {
  test('unlisted query params are NOT turned into wheres', async () => {
    // Previously every param became a where, letting clients probe any column.
    const ctx = await index({ password: 'x', internal_flag: '1' }, {})
    expect(ctx.wheres).toHaveLength(0)
  })

  test('columns in `filterable` are applied', async () => {
    const ctx = await index({ name: 'Alice', nope: 'x' }, { filterable: ['name'] })
    expect(ctx.wheres).toHaveLength(1)
    expect(ctx.wheres[0]).toMatchObject({ column: 'name', value: 'Alice' })
  })

  test('a filterable column that is also hidden is refused', async () => {
    const ctx = await index({ password: 'x' }, { filterable: ['password'] })
    expect(ctx.wheres).toHaveLength(0)
  })

  test('empty values are skipped', async () => {
    const ctx = await index({ name: '' }, { filterable: ['name'] })
    expect(ctx.wheres).toHaveLength(0)
  })

  test('a custom filters fn still wins', async () => {
    const ctx = await index({ q: '5' }, { filters: (qb, query) => qb.where('age', '>', query.q) })
    expect(ctx.wheres).toHaveLength(1)
    expect(ctx.wheres[0]).toMatchObject({ column: 'age', operator: '>', value: '5' })
  })

  test('pagination params are never treated as filters', async () => {
    const ctx = await index({ page: '2', per_page: '5' }, { filterable: ['name'] })
    expect(ctx.wheres).toHaveLength(0)
    expect(ctx.limit).toBe(5)
    expect(ctx.offset).toBe(5)
  })
})

describe('GET index — sort allowlist', () => {
  test('sortable columns are honored, with - meaning desc', async () => {
    const ctx = await index({ sort: '-name' }, { sortable: ['name'] })
    expect(ctx.orderBys).toEqual([{ column: 'name', direction: 'DESC' }])
  })

  test('columns outside sortable are ignored', async () => {
    const ctx = await index({ sort: 'password' }, { sortable: ['name'] })
    expect(ctx.orderBys).toEqual([])
  })
})

// ─── Routing, middleware and pagination fixes ─────────────────────────────────

class Post extends Model {
  static table = 'posts'
  static fillable = ['title']
  static timestamps = false
}

class Comment extends Model {
  static table = 'comments'
  static fillable = ['body', 'post_id']
  static timestamps = false
  static softDeletes = true
}

/** Drive one request through a router and report what happened. */
function call(router, { path, method = 'GET', query = {}, body = {} }) {
  return new Promise((done, fail) => {
    const out = { statusCode: null, body: undefined, nexted: false, listeners: {} }
    const res = {
      status(c) { out.statusCode = c; return this },
      json(b) { out.body = b; done(out); return this },
      end() { done(out); return this },
      once(event, fn) { out.listeners[event] = fn; return this },
      headersSent: false,
      writableEnded: false,
    }
    const req = { path, method, query, body, params: {} }
    const timer = setTimeout(() => fail(new Error(`request to ${method} ${path} never completed`)), 1000)
    const settle = r => { clearTimeout(timer); return r }
    Promise.resolve()
      .then(() => router(req, res, err => {
        out.nexted = true
        if (err) return fail(err)
        done(out)
      }))
      .catch(fail)
      .finally(() => settle())
  })
}

describe('nested resources are reachable', () => {
  const router = () => apiRouter([
    resource(Post),
    resource(Comment, { nested: { parent: Post, foreignKey: 'post_id' } }),
  ])

  test('GET /posts/1/comments hits the comment index, not the post show', async () => {
    // This returned the post before the startsWith dispatch was replaced.
    await call(router(), { path: '/posts/1/comments' })
    const last = resolver.calls.selects.at(-1)
    expect(last.table).toBe('comments')
    expect(last.ctx.wheres).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'post_id', value: '1' })]),
    )
  })

  test('GET /posts/1/comments/5 scopes to the child id', async () => {
    await call(router(), { path: '/posts/1/comments/5' })
    const last = resolver.calls.selects.at(-1)
    expect(last.table).toBe('comments')
    expect(last.ctx.wheres).toEqual(
      expect.arrayContaining([expect.objectContaining({ column: 'id', value: '5' })]),
    )
  })

  test('GET /posts/1 still hits the post show', async () => {
    await call(router(), { path: '/posts/1' })
    expect(resolver.calls.selects.at(-1).table).toBe('posts')
  })

  test('an unknown path falls through to next()', async () => {
    const out = await call(router(), { path: '/widgets' })
    expect(out.nexted).toBe(true)
  })

  test('a literal sub-route wins over :id', async () => {
    await call(apiRouter([resource(Comment)]), { path: '/comments/trashed' })
    const ctx = resolver.calls.selects.at(-1).ctx
    expect(ctx.wheres).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'notNull', column: 'deleted_at' })]),
    )
  })
})

describe('middleware contract', () => {
  test('middleware that answers the request does not hang', async () => {
    const router = apiRouter([resource(User, {
      middleware: [(req, res) => { res.status(401).json({ error: 'nope' }) }],
    })])
    const out = await call(router, { path: '/users' })
    expect(out.statusCode).toBe(401)
    expect(out.body).toEqual({ error: 'nope' })
  })

  test('middleware calling next() lets the handler run', async () => {
    let ran = false
    const router = apiRouter([resource(User, {
      middleware: [(req, res, next) => { ran = true; next() }],
    })])
    await call(router, { path: '/users' })
    expect(ran).toBe(true)
    expect(resolver.calls.selects.at(-1).table).toBe('users')
  })

  test('middleware passing an error goes to next(err)', async () => {
    const router = apiRouter([resource(User, {
      middleware: [(req, res, next) => next(new Error('bad token'))],
    })])
    await expect(call(router, { path: '/users' })).rejects.toThrow('bad token')
  })
})

describe('pagination input is clamped', () => {
  const ctxFor = async query => {
    await call(apiRouter([resource(User)]), { path: '/users', query })
    return resolver.calls.selects.at(-1).ctx
  }

  test('a non-numeric per_page falls back to the default', async () => {
    // Math.min(NaN, 100) is NaN, which used to reach the driver as the LIMIT.
    expect((await ctxFor({ per_page: 'abc' })).limit).toBe(15)
  })

  test('per_page is capped at maxPerPage', async () => {
    expect((await ctxFor({ per_page: '1000000' })).limit).toBe(100)
  })

  test('page=0 does not produce a negative offset', async () => {
    expect((await ctxFor({ page: '0' })).offset).toBe(0)
  })

  test('page=-5 does not produce a negative offset', async () => {
    expect((await ctxFor({ page: '-5' })).offset).toBe(0)
  })
})

describe('policies cover every action', () => {
  const denied = []
  const policy = async (req, model, action) => { denied.push(action); return false }

  test('trashed is refused', async () => {
    const out = await call(apiRouter([resource(Comment, { policy })]), { path: '/comments/trashed' })
    expect(out.statusCode).toBe(403)
    expect(denied).toContain('trashed')
  })

  test('index is refused', async () => {
    const out = await call(apiRouter([resource(User, { policy })]), { path: '/users' })
    expect(out.statusCode).toBe(403)
  })
})

describe('?with= is opt-in', () => {
  test('a relation not listed in `with` is ignored', async () => {
    await call(apiRouter([resource(User)]), { path: '/users', query: { with: 'secretRelation' } })
    // No eager load attempted → only the one select for the page.
    expect(resolver.calls.selects).toHaveLength(1)
  })
})
