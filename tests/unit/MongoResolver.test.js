/**
 * Unit tests — MongoDB filter builder (@eloquentjs/mongodb)
 *
 * Exercises buildFilter() through MongoResolver.select() with a mock db,
 * so no mongod is required. The filter is the driver's whole translation
 * layer — where types, operator mapping, OR precedence, nested groups.
 */

import { MongoResolver } from '../../packages/mongodb/src/index.js'

// Mock db: collection().find() records the filter and returns an empty cursor.
function makeMockDb(captured = []) {
  const cursor = {
    project() { return cursor },
    sort()    { return cursor },
    skip()    { return cursor },
    limit()   { return cursor },
    async toArray() { return [] },
  }
  return {
    databaseName: 'test',
    collection() {
      return {
        find(filter) { captured.push(filter); return cursor },
        async insertMany(docs) { captured.push(docs); return { insertedIds: docs.map((_, i) => `id${i}`) } },
      }
    },
  }
}

// Return the filter MongoResolver built for a given context.
async function filterFor(ctx) {
  const captured = []
  await new MongoResolver(makeMockDb(captured)).select('users', { selects: ['*'], ...ctx })
  return captured[0]
}

describe('Where type translation', () => {
  test('equality', async () => {
    expect(await filterFor({ wheres: [{ column: 'name', operator: '=', value: 'Alice', boolean: 'and' }] }))
      .toEqual({ name: { $eq: 'Alice' } })
  })

  test('comparison operators map to mongo operators', async () => {
    expect(await filterFor({ wheres: [{ column: 'age', operator: '>=', value: 18, boolean: 'and' }] }))
      .toEqual({ age: { $gte: 18 } })
  })

  test('in / notIn', async () => {
    expect(await filterFor({ wheres: [{ type: 'in', column: 'role', values: ['a', 'b'], boolean: 'and' }] }))
      .toEqual({ role: { $in: ['a', 'b'] } })
    expect(await filterFor({ wheres: [{ type: 'notIn', column: 'role', values: ['a'], boolean: 'and' }] }))
      .toEqual({ role: { $nin: ['a'] } })
  })

  test('null / notNull', async () => {
    expect(await filterFor({ wheres: [{ type: 'null', column: 'deleted_at', boolean: 'and' }] }))
      .toEqual({ deleted_at: { $eq: null } })
    expect(await filterFor({ wheres: [{ type: 'notNull', column: 'deleted_at', boolean: 'and' }] }))
      .toEqual({ deleted_at: { $ne: null } })
  })

  test('between', async () => {
    expect(await filterFor({ wheres: [{ type: 'between', column: 'age', min: 18, max: 65, boolean: 'and' }] }))
      .toEqual({ age: { $gte: 18, $lte: 65 } })
  })

  test('LIKE becomes an anchored case-insensitive regex', async () => {
    const f = await filterFor({ wheres: [{ column: 'name', operator: 'LIKE', value: '%ali%', boolean: 'and' }] })
    expect(f.name.$regex).toBeInstanceOf(RegExp)
    expect(f.name.$regex.test('Alice')).toBe(true)
    expect(f.name.$regex.test('Bob')).toBe(false)
  })

  test('no wheres means an empty filter', async () => {
    expect(await filterFor({ wheres: [] })).toEqual({})
  })
})

describe('AND / OR precedence', () => {
  test('all-AND collapses to $and', async () => {
    expect(await filterFor({ wheres: [
      { column: 'a', operator: '=', value: 1, boolean: 'and' },
      { column: 'b', operator: '=', value: 2, boolean: 'and' },
    ] })).toEqual({ $and: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }] })
  })

  test('OR is honored, not silently dropped', async () => {
    expect(await filterFor({ wheres: [
      { column: 'a', operator: '=', value: 1, boolean: 'and' },
      { column: 'b', operator: '=', value: 2, boolean: 'or' },
    ] })).toEqual({ $or: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }] })
  })

  test('OR splits runs; each run is AND-ed — a OR (b AND c)', async () => {
    expect(await filterFor({ wheres: [
      { column: 'a', operator: '=', value: 1, boolean: 'and' },
      { column: 'b', operator: '=', value: 2, boolean: 'or' },
      { column: 'c', operator: '=', value: 3, boolean: 'and' },
    ] })).toEqual({ $or: [
      { a: { $eq: 1 } },
      { $and: [{ b: { $eq: 2 } }, { c: { $eq: 3 } }] },
    ] })
  })
})

describe('Nested where groups', () => {
  test('a group becomes a nested clause under the scope', async () => {
    // scope AND (a OR b) — the soft-delete filter must not be OR-ed away
    expect(await filterFor({ wheres: [
      { type: 'null', column: 'deleted_at', boolean: 'and', _scope: '_softDelete' },
      { type: 'group', boolean: 'and', wheres: [
        { column: 'a', operator: '=', value: 1, boolean: 'and' },
        { column: 'b', operator: '=', value: 2, boolean: 'or' },
      ] },
    ] })).toEqual({ $and: [
      { deleted_at: { $eq: null } },
      { $or: [{ a: { $eq: 1 } }, { b: { $eq: 2 } }] },
    ] })
  })

  test('an empty group contributes nothing', async () => {
    expect(await filterFor({ wheres: [{ type: 'group', boolean: 'and', wheres: [] }] })).toEqual({})
  })
})

describe('insertMany', () => {
  test('inserts one batch and returns normalized docs', async () => {
    const captured = []
    const r = new MongoResolver(makeMockDb(captured))
    const rows = await r.insertMany('users', [{ name: 'a' }, { name: 'b' }])
    expect(captured[0]).toHaveLength(2)
    expect(rows.map(d => d.name)).toEqual(['a', 'b'])
    expect(rows.map(d => d.id)).toEqual(['id0', 'id1'])
  })

  test('empty input is a no-op', async () => {
    const captured = []
    const r = new MongoResolver(makeMockDb(captured))
    expect(await r.insertMany('users', [])).toEqual([])
    expect(captured).toHaveLength(0)
  })
})
