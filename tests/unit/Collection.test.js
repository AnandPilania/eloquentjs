/**
 * Unit tests — Collection
 */

import { Collection } from '../../packages/core/src/Collection.js'

describe('Collection', () => {
  const items = () => new Collection([
    { id: 1, name: 'Alice', age: 30, country: 'US', score: 90 },
    { id: 2, name: 'Bob',   age: 25, country: 'UK', score: 70 },
    { id: 3, name: 'Carol', age: 35, country: 'US', score: 80 },
    { id: 4, name: 'Dave',  age: 25, country: 'AU', score: null },
  ])

  // ─── Access ──────────────────────────────────────────────────────────────
  test('first() returns first element', () => {
    expect(items().first()).toMatchObject({ id: 1 })
  })

  test('first() returns null on empty collection', () => {
    expect(new Collection().first()).toBeNull()
  })

  test('last() returns last element', () => {
    expect(items().last()).toMatchObject({ id: 4 })
  })

  test('nth() returns element by index', () => {
    expect(items().nth(2)).toMatchObject({ id: 3 })
  })

  test('isEmpty() / isNotEmpty()', () => {
    expect(new Collection().isEmpty()).toBe(true)
    expect(items().isNotEmpty()).toBe(true)
  })

  // ─── Pluck / KeyBy / GroupBy ──────────────────────────────────────────
  test('pluck(key) returns Collection of values', () => {
    const names = items().pluck('name')
    expect(names).toBeInstanceOf(Collection)
    expect(Array.from(names)).toEqual(['Alice', 'Bob', 'Carol', 'Dave'])
  })

  test('pluck(value, key) returns keyed object', () => {
    const map = items().pluck('name', 'id')
    expect(map).toEqual({ 1: 'Alice', 2: 'Bob', 3: 'Carol', 4: 'Dave' })
  })

  test('keyBy() returns an object keyed by field', () => {
    const keyed = items().keyBy('id')
    expect(keyed[2].name).toBe('Bob')
  })

  test('groupBy() groups items by field', () => {
    const groups = items().groupBy('country')
    expect(groups['US']).toHaveLength(2)
    expect(groups['UK']).toHaveLength(1)
    expect(groups['AU']).toHaveLength(1)
  })

  test('groupBy() with function key', () => {
    const groups = items().groupBy(i => i.age >= 30 ? 'senior' : 'junior')
    expect(groups['senior']).toHaveLength(2)
    expect(groups['junior']).toHaveLength(2)
  })

  // ─── Filtering ────────────────────────────────────────────────────────────
  test('where() with equality operator', () => {
    const us = items().where('country', 'US')
    expect(us).toHaveLength(2)
  })

  test('where() with comparison operator', () => {
    const adults = items().where('age', '>=', 30)
    expect(adults).toHaveLength(2)
  })

  test('whereIn()', () => {
    const found = items().whereIn('id', [1, 3])
    expect(found).toHaveLength(2)
    expect(found.pluck('name').toArray()).toEqual(['Alice', 'Carol'])
  })

  test('whereNotIn()', () => {
    const found = items().whereNotIn('country', ['US'])
    expect(found).toHaveLength(2)
  })

  test('whereNull() / whereNotNull()', () => {
    expect(items().whereNull('score')).toHaveLength(1)
    expect(items().whereNotNull('score')).toHaveLength(3)
  })

  // ─── Aggregates ──────────────────────────────────────────────────────────
  test('sum() sums a numeric field', () => {
    expect(items().sum('age')).toBe(115)
  })

  test('avg() averages a numeric field', () => {
    expect(items().avg('age')).toBe(115 / 4)
  })

  test('min() / max()', () => {
    expect(items().min('age')).toBe(25)
    expect(items().max('age')).toBe(35)
  })

  test('sum() treats null as 0', () => {
    expect(items().sum('score')).toBe(240)
  })

  // ─── Sorting ─────────────────────────────────────────────────────────────
  test('sortBy() ascending', () => {
    const sorted = items().sortBy('age')
    expect(sorted.pluck('id').toArray()).toEqual([2, 4, 1, 3])
  })

  test('sortBy() descending', () => {
    const sorted = items().sortBy('age', 'desc')
    expect(sorted.first().id).toBe(3)
  })

  test('sortByDesc() is sortBy desc alias', () => {
    const sorted = items().sortByDesc('score')
    expect(sorted.first().score).toBe(90)
  })

  // ─── Transformation ──────────────────────────────────────────────────────
  test('unique() deduplicates by key', () => {
    const uniq = items().unique('country')
    expect(uniq).toHaveLength(3)
  })

  test('unique() without key deduplicates primitives', () => {
    const c = new Collection([1, 2, 2, 3, 3, 3])
    expect(c.unique()).toHaveLength(3)
  })

  test('chunk() splits into sub-collections', () => {
    const chunks = items().chunk(2)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(2)
    expect(chunks[1]).toHaveLength(2)
  })

  test('only() returns specified keys', () => {
    const out = items().only('id', 'name')
    expect(Object.keys(out[0])).toEqual(['id', 'name'])
  })

  test('except() removes specified keys', () => {
    const items2 = new Collection([{ id: 1, name: 'Alice', password: 'secret' }])
    const out = items2.except('password')
    expect(out[0]).not.toHaveProperty('password')
    expect(out[0]).toHaveProperty('name')
  })

  // ─── Side effects ────────────────────────────────────────────────────────
  test('each() iterates and returns self', () => {
    const seen = []
    const result = items().each(i => seen.push(i.id))
    expect(seen).toEqual([1, 2, 3, 4])
    expect(result).toBeInstanceOf(Collection)
  })

  test('tap() calls fn with collection and returns self', () => {
    let tapped = null
    const result = items().tap(c => { tapped = c })
    expect(tapped).toBe(result)
  })

  test('when() executes fn when condition truthy', () => {
    let ran = false
    items().when(true, () => { ran = true })
    expect(ran).toBe(true)
  })

  test('when() skips fn when condition falsy', () => {
    let ran = false
    items().when(false, () => { ran = true })
    expect(ran).toBe(false)
  })

  // ─── Serialization ───────────────────────────────────────────────────────
  test('toArray() returns plain array', () => {
    const arr = items().toArray()
    expect(Array.isArray(arr)).toBe(true)
    expect(arr).not.toBeInstanceOf(Collection)
  })

  test('toJSON() calls toJSON on items that have it', () => {
    const mockItem = { toJSON: () => ({ id: 99, name: 'Test' }) }
    const c = new Collection([mockItem])
    const json = c.toJSON()
    expect(json[0]).toEqual({ id: 99, name: 'Test' })
  })

  // ─── Array method inheritance ─────────────────────────────────────────────
  test('map() works on Collection', () => {
    const ids = items().map(i => i.id)
    expect(ids).toEqual([1, 2, 3, 4])
  })

  test('filter() works on Collection', () => {
    const result = items().filter(i => i.age > 25)
    expect(result).toHaveLength(2)
  })

  test('reduce() works on Collection', () => {
    const total = items().reduce((acc, i) => acc + i.age, 0)
    expect(total).toBe(115)
  })
})
