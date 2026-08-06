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

  // These three return Maps rather than plain objects: a plain object coerces
  // every key to a string and a value of '__proto__' or 'constructor' silently
  // mis-keys or throws.
  test('pluck(value, key) returns a Map', () => {
    const map = items().pluck('name', 'id')
    expect(map.get(1)).toBe('Alice')
    expect(map.get(2)).toBe('Bob')
    expect(map.size).toBe(4)
  })

  test('keyBy() returns a Map keyed by field, preserving key types', () => {
    const keyed = items().keyBy('id')
    expect(keyed.get(2).name).toBe('Bob')
  })

  test('groupBy() groups items by field', () => {
    const groups = items().groupBy('country')
    expect(groups.get('US')).toHaveLength(2)
    expect(groups.get('UK')).toHaveLength(1)
    expect(groups.get('AU')).toHaveLength(1)
  })

  test('groupBy() with function key', () => {
    const groups = items().groupBy(i => i.age >= 30 ? 'senior' : 'junior')
    expect(groups.get('senior')).toHaveLength(2)
    expect(groups.get('junior')).toHaveLength(2)
  })

  test('groupBy() is safe for a "__proto__" key', () => {
    const c = new Collection([{ k: '__proto__' }, { k: '__proto__' }])
    expect(c.groupBy('k').get('__proto__')).toHaveLength(2)
  })

  test('whereIn/sum/min/max read through getAttribute like where() does', () => {
    // Previously where() applied casts and accessors while these did not.
    const fake = v => ({ getAttribute: k => (k === 'n' ? v : undefined), n: 'raw' })
    const c = new Collection([fake(1), fake(2), fake(3)])
    expect(c.whereIn('n', [2, 3])).toHaveLength(2)
    expect(c.sum('n')).toBe(6)
    expect(c.min('n')).toBe(1)
    expect(c.max('n')).toBe(3)
  })

  test('sum() with no key sums the items themselves', () => {
    expect(new Collection([1, 2, 3]).sum()).toBe(6)
  })

  test('each() stops when the callback returns false', () => {
    const seen = []
    new Collection([1, 2, 3]).each(n => { seen.push(n); if (n === 2) return false })
    expect(seen).toEqual([1, 2])
  })

  test('contains(), partition(), implode(), sole() and median()', () => {
    const c = items()
    expect(c.contains('name', 'Bob')).toBe(true)
    expect(c.contains('name', 'Zed')).toBe(false)
    expect(c.contains(i => i.age >= 30)).toBe(true)

    const [seniors, juniors] = c.partition(i => i.age >= 30)
    expect(seniors).toHaveLength(2)
    expect(juniors).toHaveLength(2)

    expect(c.implode('name', ' | ')).toContain('Alice | Bob')
    expect(new Collection(['a', 'b']).implode('-')).toBe('a-b')

    expect(c.sole(i => i.name === 'Bob').id).toBe(2)
    expect(() => c.sole()).toThrow(/items matched/)
    expect(typeof c.median('age')).toBe('number')
  })

  test('only() and except() are symmetric', () => {
    const c = new Collection([{ a: 1, b: 2, c: 3 }])
    expect(c.only('a', 'b')[0]).toEqual({ a: 1, b: 2 })
    expect(c.except('c')[0]).toEqual({ a: 1, b: 2 })
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
