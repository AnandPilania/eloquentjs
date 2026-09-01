/**
 * Unit tests — MongoDB filter builder (@eloquentjs/mongodb)
 *
 * Exercises buildFilter() through MongoResolver.select() with a mock db,
 * so no mongod is required. The filter is the driver's whole translation
 * layer — where types, operator mapping, OR precedence, nested groups.
 */

import { ObjectId } from 'mongodb'
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

  // Model.query()'s soft-delete scope qualifies the column with the model's
  // table ("users.deleted_at"), so the filter stays unambiguous across a SQL
  // join. Mongo has no joins and reads a dot as a *nested* field path — left
  // unqualified, "users.deleted_at" filtered a sub-document that never
  // exists, which silently matched everything (including soft-deleted rows)
  // instead of the real top-level `deleted_at` field.
  test('a column qualified with this collection\'s own table name is unwrapped', async () => {
    expect(await filterFor({ wheres: [{ type: 'null', column: 'users.deleted_at', boolean: 'and' }] }))
      .toEqual({ deleted_at: { $eq: null } })
  })

  test('a genuine nested-field path is left alone', async () => {
    expect(await filterFor({ wheres: [{ column: 'address.city', operator: '=', value: 'NYC', boolean: 'and' }] }))
      .toEqual({ 'address.city': { $eq: 'NYC' } })
  })

  test('"table.id" unwraps to _id, not just "id"', async () => {
    expect(await filterFor({ wheres: [{ column: 'users.id', operator: '=', value: '1', boolean: 'and' }] }))
      .toEqual({ _id: { $eq: '1' } })
  })
})

describe('_id primary-key lookups', () => {
  test('where("_id", stringId) normalizes to ObjectId so it can match', async () => {
    const id = new ObjectId().toString()
    const f = await filterFor({ wheres: [{ column: '_id', operator: '=', value: id, boolean: 'and' }] })
    expect(f._id.$eq).toBeInstanceOf(ObjectId)
    expect(f._id.$eq.toString()).toBe(id)
  })

  test('whereIn("_id", stringIds) normalizes every value', async () => {
    const ids = [new ObjectId().toString(), new ObjectId().toString()]
    const f = await filterFor({ wheres: [{ type: 'in', column: '_id', values: ids, boolean: 'and' }] })
    expect(f._id.$in.every(v => v instanceof ObjectId)).toBe(true)
    expect(f._id.$in.map(String)).toEqual(ids)
  })

  test('an invalid _id string is passed through unchanged, not thrown', async () => {
    const f = await filterFor({ wheres: [{ column: '_id', operator: '=', value: 'not-an-object-id', boolean: 'and' }] })
    expect(f._id.$eq).toBe('not-an-object-id')
  })

  test('non-_id columns are left untouched', async () => {
    const f = await filterFor({ wheres: [{ column: 'name', operator: '=', value: 'Alice', boolean: 'and' }] })
    expect(f.name.$eq).toBe('Alice')
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
