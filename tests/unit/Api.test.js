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
