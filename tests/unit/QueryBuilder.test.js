/**
 * Unit tests — QueryBuilder
 * Tests query building via a mock resolver that captures context objects.
 */

import { QueryBuilder } from '../../packages/core/src/QueryBuilder.js'
import { setResolver, clearResolvers } from '../../packages/core/src/ConnectionRegistry.js'
import { Collection }   from '../../packages/core/src/Collection.js'
import { Model, withScopes } from '../../packages/core/src/Model.js'

// ─── Mock resolver ────────────────────────────────────────────────────────────
function makeCapturingResolver(returnRows = []) {
  const calls = { selects: [], updates: [], deletes: [], aggregates: [], increments: [] }
  return {
    calls,
    async select(table, ctx)              { calls.selects.push({ table, ctx });           return returnRows },
    async insert(table, data)             { return { ...data, id: 1 } },
    async update(table, cond, data, ctx)  { calls.updates.push({ table, cond, data, ctx }); return 1 },
    async delete(table, cond, ctx)        { calls.deletes.push({ table, cond, ctx });      return 1 },
    async aggregate(table, fn, col, ctx)  { calls.aggregates.push({ fn, col, ctx });       return fn === 'count' ? returnRows.length : 0 },
    async increment(table, col, amt, extra, ctx) { calls.increments.push({ col, amt, ctx }); return 1 },
    async toSQL(table, ctx)               { return { sql: `SELECT * FROM "${table}"`, params: [] } },
  }
}

class User extends Model {
  static table      = 'users'
  static fillable   = ['name', 'email']
  static timestamps = false

  static scopeActive(qb) { return qb.where('active', true) }
  static scopeAdmins(qb) { return qb.where('is_admin', true) }
}

class Post extends Model {
  static table       = 'posts'
  static fillable    = ['title']
  static softDeletes = true
  static timestamps  = false
}

let resolver

beforeEach(() => {
  resolver = makeCapturingResolver()
  clearResolvers()
  setResolver(resolver)
})

// ─── WHERE clauses ────────────────────────────────────────────────────────────
describe('WHERE clauses', () => {
  test('where(col, val) — equality shorthand', async () => {
    await User.where('name', 'Alice').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.column).toBe('name')
    expect(w.operator).toBe('=')
    expect(w.value).toBe('Alice')
    expect(w.boolean).toBe('and')
  })

  test('where(col, op, val) — custom operator', async () => {
    await User.where('age', '>', 18).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.operator).toBe('>')
    expect(w.value).toBe(18)
  })

  test('where(object) — multiple conditions', async () => {
    await User.where({ name: 'Alice', active: true }).get()
    const wheres = resolver.calls.selects[0].ctx.wheres
    expect(wheres).toHaveLength(2)
    expect(wheres.map(w => w.column)).toEqual(['name', 'active'])
  })

  test('orWhere() — sets boolean to "or"', async () => {
    await User.where('name', 'Alice').orWhere('name', 'Bob').get()
    const wheres = resolver.calls.selects[0].ctx.wheres
    expect(wheres[0].boolean).toBe('and')
    expect(wheres[1].boolean).toBe('or')
  })

  test('whereNot()', async () => {
    await User.whereNot('status', 'banned').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.operator).toBe('!=')
    expect(w.value).toBe('banned')
  })

  test('whereIn()', async () => {
    await User.whereIn('id', [1, 2, 3]).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('in')
    expect(w.values).toEqual([1, 2, 3])
  })

  test('whereNotIn()', async () => {
    await User.whereNotIn('role', ['banned']).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('notIn')
    expect(w.values).toEqual(['banned'])
  })

  test('whereNull()', async () => {
    await User.whereNull('deleted_at').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('null')
    expect(w.column).toBe('deleted_at')
  })

  test('whereNotNull()', async () => {
    await User.whereNotNull('email_verified_at').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('notNull')
  })

  test('whereBetween()', async () => {
    await User.whereBetween('age', [18, 65]).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('between')
    expect(w.min).toBe(18)
    expect(w.max).toBe(65)
  })

  test('whereNotBetween()', async () => {
    await User.whereNotBetween('score', [0, 10]).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('notBetween')
  })

  test('whereLike()', async () => {
    await User.whereLike('name', '%Ali%').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.operator).toBe('LIKE')
    expect(w.value).toBe('%Ali%')
  })

  test('whereRaw()', async () => {
    await User.whereRaw('LOWER(email) = ?', ['alice@x.com']).get()
    const rw = resolver.calls.selects[0].ctx.rawWheres[0]
    expect(rw.sql).toBe('LOWER(email) = ?')
    expect(rw.bindings).toEqual(['alice@x.com'])
  })

  test('whereDate()', async () => {
    await User.whereDate('created_at', '2024-01-01').get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('date')
    expect(w.value).toBe('2024-01-01')
    expect(w.operator).toBe('=')
  })

  test('whereYear()', async () => {
    await User.whereYear('created_at', 2024).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('year')
    expect(w.value).toBe(2024)
  })

  test('whereMonth()', async () => {
    await User.whereMonth('created_at', 6).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('month')
    expect(w.value).toBe(6)
  })

  test('whereJsonContains()', async () => {
    await User.whereJsonContains('settings', { theme: 'dark' }).get()
    const w = resolver.calls.selects[0].ctx.wheres[0]
    expect(w.type).toBe('jsonContains')
    expect(w.value).toEqual({ theme: 'dark' })
  })

  test('multiple chained wheres accumulate', async () => {
    await User.where('active', true).where('age', '>', 18).whereNotNull('email').get()
    expect(resolver.calls.selects[0].ctx.wheres).toHaveLength(3)
  })
})

// ─── SELECT / DISTINCT ────────────────────────────────────────────────────────
describe('SELECT / DISTINCT', () => {
  test('select() limits columns', async () => {
    await User.select('id', 'name').get()
    expect(resolver.calls.selects[0].ctx.selects).toEqual(['id', 'name'])
  })

  test('select(array) flattens', async () => {
    await User.select(['id', 'email']).get()
    expect(resolver.calls.selects[0].ctx.selects).toEqual(['id', 'email'])
  })

  test('addSelect() appends without removing existing', async () => {
    const qb = User.select('id').addSelect('name', 'email')
    expect(qb._selects).toEqual(['id', 'name', 'email'])
  })

  test('addSelect() removes default * before appending', async () => {
    const qb = new QueryBuilder(User, resolver)
    qb.addSelect('name')
    expect(qb._selects).not.toContain('*')
    expect(qb._selects).toContain('name')
  })

  test('distinct() sets flag in context', async () => {
    await User.distinct().get()
    expect(resolver.calls.selects[0].ctx.distinct).toBe(true)
  })
})

// ─── ORDER BY ─────────────────────────────────────────────────────────────────
describe('ORDER BY', () => {
  test('orderBy() defaults to ASC', async () => {
    await User.orderBy('name').get()
    expect(resolver.calls.selects[0].ctx.orderBys[0].direction).toBe('ASC')
  })

  test('orderBy(col, desc) sets DESC', async () => {
    await User.orderBy('name', 'desc').get()
    expect(resolver.calls.selects[0].ctx.orderBys[0].direction).toBe('DESC')
  })

  test('orderByDesc() shorthand', async () => {
    await User.orderByDesc('created_at').get()
    expect(resolver.calls.selects[0].ctx.orderBys[0].direction).toBe('DESC')
  })

  test('multiple orderBy() calls all appear in orderBys array', async () => {
    await User.orderBy('country').orderBy('name', 'desc').orderBy('id').get()
    const obs = resolver.calls.selects[0].ctx.orderBys
    expect(obs).toHaveLength(3)
    expect(obs[0].column).toBe('country')
    expect(obs[1].column).toBe('name')
    expect(obs[2].column).toBe('id')
  })

  test('inRandomOrder() sets random flag', async () => {
    await User.inRandomOrder().get()
    expect(resolver.calls.selects[0].ctx.orderBys[0].random).toBe(true)
  })

  test('latest() orders by created_at DESC', async () => {
    await User.latest().get()
    const o = resolver.calls.selects[0].ctx.orderBys[0]
    expect(o.column).toBe('created_at')
    expect(o.direction).toBe('DESC')
  })

  test('oldest() orders by created_at ASC', async () => {
    await User.oldest().get()
    const o = resolver.calls.selects[0].ctx.orderBys[0]
    expect(o.direction).toBe('ASC')
  })
})

// ─── LIMIT / OFFSET / FORPAGE ─────────────────────────────────────────────────
describe('LIMIT / OFFSET / forPage', () => {
  test('limit()', async () => {
    await User.limit(10).get()
    expect(resolver.calls.selects[0].ctx.limit).toBe(10)
  })

  test('take() is alias for limit()', async () => {
    await User.take(5).get()
    expect(resolver.calls.selects[0].ctx.limit).toBe(5)
  })

  test('offset()', async () => {
    await User.offset(20).get()
    expect(resolver.calls.selects[0].ctx.offset).toBe(20)
  })

  test('skip() is alias for offset()', async () => {
    await User.skip(15).get()
    expect(resolver.calls.selects[0].ctx.offset).toBe(15)
  })

  test('forPage(2, 10) sets limit=10, offset=10', async () => {
    await User.forPage(2, 10).get()
    const ctx = resolver.calls.selects[0].ctx
    expect(ctx.limit).toBe(10)
    expect(ctx.offset).toBe(10)
  })

  test('forPage(3, 20) sets offset=40', async () => {
    await User.forPage(3, 20).get()
    expect(resolver.calls.selects[0].ctx.offset).toBe(40)
  })

  test('forPage(1, n) has offset=0', async () => {
    await User.forPage(1, 15).get()
    expect(resolver.calls.selects[0].ctx.offset).toBe(0)
  })
})

// ─── JOINS ────────────────────────────────────────────────────────────────────
describe('JOINs', () => {
  test('join() → INNER JOIN', async () => {
    await User.join('posts', 'users.id', '=', 'posts.user_id').get()
    const j = resolver.calls.selects[0].ctx.joins[0]
    expect(j.type).toBe('INNER')
    expect(j.table).toBe('posts')
    expect(j.first).toBe('users.id')
    expect(j.operator).toBe('=')
    expect(j.second).toBe('posts.user_id')
  })

  test('leftJoin() → LEFT JOIN', async () => {
    await User.leftJoin('profiles', 'users.id', '=', 'profiles.user_id').get()
    expect(resolver.calls.selects[0].ctx.joins[0].type).toBe('LEFT')
  })

  test('rightJoin() → RIGHT JOIN', async () => {
    await User.rightJoin('orders', 'users.id', '=', 'orders.user_id').get()
    expect(resolver.calls.selects[0].ctx.joins[0].type).toBe('RIGHT')
  })

  test('crossJoin() → CROSS JOIN', async () => {
    await User.crossJoin('sizes').get()
    expect(resolver.calls.selects[0].ctx.joins[0].type).toBe('CROSS')
  })
})

// ─── GROUP BY / HAVING ────────────────────────────────────────────────────────
describe('GROUP BY / HAVING', () => {
  test('groupBy() with single column', async () => {
    await User.groupBy('country').get()
    expect(resolver.calls.selects[0].ctx.groupBys).toContain('country')
  })

  test('groupBy() with multiple columns', async () => {
    await User.groupBy('country', 'status').get()
    expect(resolver.calls.selects[0].ctx.groupBys).toHaveLength(2)
  })

  test('having() two-arg shorthand defaults to =', async () => {
    const qb = User.groupBy('status').having('count', 5)
    expect(qb._havings[0].operator).toBe('=')
    expect(qb._havings[0].value).toBe(5)
  })

  test('having() three-arg with operator', async () => {
    const qb = User.groupBy('status').having('count', '>', 5)
    expect(qb._havings[0].operator).toBe('>')
  })
})

// ─── SOFT DELETE scopes ───────────────────────────────────────────────────────
describe('Soft delete scopes', () => {
  test('query() auto-adds whereNull(deleted_at)', () => {
    const qb = Post.query()
    expect(qb._wheres.some(w => w.type === 'null' && w.column === 'deleted_at')).toBe(true)
  })

  test('withTrashed() removes whereNull(deleted_at)', () => {
    const qb = Post.withTrashed()
    expect(qb._wheres.some(w => w.type === 'null' && w.column === 'deleted_at')).toBe(false)
  })

  test('onlyTrashed() adds whereNotNull(deleted_at)', () => {
    const qb = Post.onlyTrashed()
    expect(qb._wheres.some(w => w.type === 'null'    && w.column === 'deleted_at')).toBe(false)
    expect(qb._wheres.some(w => w.type === 'notNull' && w.column === 'deleted_at')).toBe(true)
  })

  test('withTrashed() + where() still includes that where', () => {
    const qb = Post.withTrashed().where('user_id', 1)
    expect(qb._wheres.some(w => w.column === 'user_id')).toBe(true)
    expect(qb._wheres.some(w => w.type === 'null')).toBe(false)
  })
})

// ─── EAGER LOADING ────────────────────────────────────────────────────────────
describe('with() eager loading registration', () => {
  test('with(string) registers relation name', () => {
    const qb = User.with('profile', 'posts')
    expect(qb._withs).toHaveLength(2)
    expect(qb._withs[0].name).toBe('profile')
    expect(qb._withs[1].name).toBe('posts')
  })

  test('with(object) registers constrained relation', () => {
    const fn = qb => qb.where('published', true)
    const qb = User.with({ posts: fn })
    expect(qb._withs[0].name).toBe('posts')
    expect(qb._withs[0].constraints).toBe(fn)
  })

  test('with() supports nested dot notation', () => {
    const qb = User.with('posts.comments.author')
    expect(qb._withs[0].name).toBe('posts.comments.author')
  })

  test('with() array shorthand', () => {
    const qb = User.with(['profile', 'posts'])
    expect(qb._withs).toHaveLength(2)
  })
})

// ─── AGGREGATES ───────────────────────────────────────────────────────────────
describe('Aggregates', () => {
  test('count() calls resolver aggregate with count', async () => {
    await User.count()
    expect(resolver.calls.aggregates[0].fn).toBe('count')
    expect(resolver.calls.aggregates[0].col).toBe('*')
  })

  test('count(col) passes column', async () => {
    await User.count('id')
    expect(resolver.calls.aggregates[0].col).toBe('id')
  })

  test('max(col)', async () => {
    await User.max('age')
    expect(resolver.calls.aggregates[0].fn).toBe('max')
    expect(resolver.calls.aggregates[0].col).toBe('age')
  })

  test('min(col)', async () => {
    await User.min('age')
    expect(resolver.calls.aggregates[0].fn).toBe('min')
  })

  test('sum(col)', async () => {
    await User.sum('balance')
    expect(resolver.calls.aggregates[0].fn).toBe('sum')
  })

  test('avg(col)', async () => {
    await User.avg('score')
    expect(resolver.calls.aggregates[0].fn).toBe('avg')
  })

  test('exists() returns boolean true when count > 0', async () => {
    resolver.calls.aggregates = []
    // resolver returns returnRows.length = 0 → exists = false
    const result = await User.exists()
    expect(result).toBe(false)
  })

  test('doesntExist() is inverse of exists()', async () => {
    const result = await User.doesntExist()
    expect(result).toBe(true)
  })
})

// ─── BULK UPDATE / DELETE / INCREMENT ────────────────────────────────────────
describe('Bulk mutations', () => {
  test('update() calls resolver with ctx', async () => {
    await User.where('active', false).update({ active: true })
    expect(resolver.calls.updates).toHaveLength(1)
    expect(resolver.calls.updates[0].data).toEqual({ active: true })
  })

  test('delete() calls resolver delete (hard)', async () => {
    await User.where('id', 1).delete()
    expect(resolver.calls.deletes).toHaveLength(1)
  })

  test('forceDelete() calls resolver delete', async () => {
    await Post.where('id', 1).forceDelete()
    expect(resolver.calls.deletes).toHaveLength(1)
  })

  test('soft delete via delete() calls update not delete', async () => {
    await Post.where('id', 1).delete()
    expect(resolver.calls.updates).toHaveLength(1)
    expect(resolver.calls.updates[0].data).toHaveProperty('deleted_at')
    expect(resolver.calls.deletes).toHaveLength(0)
  })

  test('increment()', async () => {
    await User.where('id', 1).increment('views', 1)
    expect(resolver.calls.increments[0].col).toBe('views')
    expect(resolver.calls.increments[0].amt).toBe(1)
  })

  test('decrement() passes negative amount', async () => {
    await User.where('id', 1).decrement('stock', 3)
    expect(resolver.calls.increments[0].amt).toBe(-3)
  })
})

// ─── PAGINATE ─────────────────────────────────────────────────────────────────
describe('paginate()', () => {
  test('returns data and meta', async () => {
    const result = await User.paginate(1, 15)
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('meta')
    expect(result.meta.per_page).toBe(15)
    expect(result.meta.current_page).toBe(1)
  })

  test('meta.has_more false when total=0', async () => {
    const result = await User.paginate(1, 15)
    expect(result.meta.has_more).toBe(false)
  })

  test('data is a Collection', async () => {
    const result = await User.paginate(1, 15)
    expect(result.data).toBeInstanceOf(Collection)
  })

  test('last_page is at least 1 when total=0', async () => {
    const result = await User.paginate(1, 15)
    expect(result.meta.last_page).toBe(1)
  })
})

// ─── CHUNK ───────────────────────────────────────────────────────────────────
describe('chunk()', () => {
  test('calls callback with each page of results', async () => {
    const threeRowResolver = makeCapturingResolver([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ])
    setResolver(threeRowResolver)

    const batches = []
    await User.chunk(2, async (batch, page) => {
      batches.push({ page, count: batch.length })
      return false // stop after first batch
    })

    expect(batches).toHaveLength(1)
    expect(batches[0].page).toBe(1)
    expect(batches[0].count).toBe(2)
  })

  test('stops when callback returns false', async () => {
    const rowResolver = makeCapturingResolver([{ id: 1 }, { id: 2 }])
    setResolver(rowResolver)

    let calls = 0
    await User.chunk(2, async () => { calls++; return false })
    expect(calls).toBe(1)
  })

  test('stops when batch is smaller than chunk size (last page)', async () => {
    let page = 0
    // First page returns 2 rows, second returns 1 (< chunk size), third returns 0
    const dynamicResolver = {
      async select() {
        page++
        if (page === 1) return [{ id: 1 }, { id: 2 }]
        if (page === 2) return [{ id: 3 }]
        return []
      },
      async aggregate() { return 3 },
      async insert(t, d) { return { ...d, id: 1 } },
    }
    setResolver(dynamicResolver)

    const batches = []
    await User.chunk(2, async (batch) => { batches.push(batch.length) })
    expect(batches).toEqual([2, 1])
  })
})

// ─── THENABLE ─────────────────────────────────────────────────────────────────
describe('QueryBuilder is thenable (await-able)', () => {
  test('await on builder returns Collection', async () => {
    const result = await User.where('active', true)
    expect(result).toBeInstanceOf(Collection)
  })

  test('then() resolves to Collection', () => {
    return User.where('active', true).then(result => {
      expect(result).toBeInstanceOf(Collection)
    })
  })
})

// ─── pluck / value ────────────────────────────────────────────────────────────
describe('pluck() and value()', () => {
  test('pluck() extracts column values', async () => {
    const rowResolver = makeCapturingResolver([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
    setResolver(rowResolver)

    const names = await User.pluck('name')
    expect(names).toEqual(['Alice', 'Bob'])
  })

  test('pluck(value, key) returns keyed object', async () => {
    const rowResolver = makeCapturingResolver([{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }])
    setResolver(rowResolver)

    const map = await User.pluck('name', 'id')
    expect(map).toEqual({ 1: 'Alice', 2: 'Bob' })
  })

  test('value() returns single column from first row', async () => {
    const rowResolver = makeCapturingResolver([{ email: 'alice@test.com' }])
    setResolver(rowResolver)

    const email = await User.where('id', 1).value('email')
    expect(email).toBe('alice@test.com')
  })

  test('value() returns null when no rows', async () => {
    const val = await User.where('id', 999).value('email')
    expect(val).toBeNull()
  })
})

// ─── LOCAL SCOPES ─────────────────────────────────────────────────────────────
describe('Local scopes via withScopes proxy', () => {
  const SU = withScopes(User)

  test('SU.active() calls scopeActive', async () => {
    const qb = SU.active()
    expect(qb._wheres.some(w => w.column === 'active' && w.value === true)).toBe(true)
  })

  test('SU.admins() calls scopeAdmins', async () => {
    const qb = SU.admins()
    expect(qb._wheres.some(w => w.column === 'is_admin')).toBe(true)
  })

  test('scopes each produce independent QBs (scope chaining via query)', async () => {
    const qb1 = SU.active()
    const qb2 = SU.admins()
    expect(qb1._wheres.some(w => w.column === 'active')).toBe(true)
    expect(qb2._wheres.some(w => w.column === 'is_admin')).toBe(true)
  })
})

// ─── Context isolation ────────────────────────────────────────────────────────
describe('Context isolation — builder state', () => {
  test('each static query() call returns a fresh builder', async () => {
    const qb1 = User.where('a', 1)
    const qb2 = User.where('b', 2)
    expect(qb1._wheres).toHaveLength(1)
    expect(qb2._wheres).toHaveLength(1)
    expect(qb1._wheres[0].column).toBe('a')
    expect(qb2._wheres[0].column).toBe('b')
  })

  test('paginate() does not mutate builder limit/offset', async () => {
    const qb = User.where('active', true)
    const origLimit  = qb._limit
    const origOffset = qb._offset
    await qb.paginate(2, 10)
    expect(qb._limit).toBe(origLimit)
    expect(qb._offset).toBe(origOffset)
  })
})
