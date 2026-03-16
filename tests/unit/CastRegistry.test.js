/**
 * Unit tests — CastRegistry
 */

import { CastRegistry, DateCast, JsonCast, BooleanCast } from '../../packages/core/src/CastRegistry.js'

describe('CastRegistry', () => {
  // ─── integer ────────────────────────────────────────────────────────────
  test('integer: get coerces string to number', () => {
    expect(CastRegistry.get('integer', '42')).toBe(42)
  })
  test('integer: alias int works', () => {
    expect(CastRegistry.get('int', '7')).toBe(7)
  })
  test('integer: null passthrough', () => {
    expect(CastRegistry.get('integer', null)).toBeNull()
  })
  test('integer: undefined passthrough', () => {
    expect(CastRegistry.get('integer', undefined)).toBeUndefined()
  })

  // ─── float ──────────────────────────────────────────────────────────────
  test('float: coerces to float', () => {
    expect(CastRegistry.get('float', '3.14')).toBeCloseTo(3.14)
  })
  test('double alias works', () => {
    expect(CastRegistry.get('double', '2.5')).toBeCloseTo(2.5)
  })

  // ─── string ─────────────────────────────────────────────────────────────
  test('string: coerces number to string', () => {
    expect(CastRegistry.get('string', 42)).toBe('42')
  })
  test('string: null passthrough', () => {
    expect(CastRegistry.get('string', null)).toBeNull()
  })

  // ─── boolean ────────────────────────────────────────────────────────────
  test('boolean: true string truthy', () => {
    expect(CastRegistry.get('boolean', 'true')).toBe(true)
  })
  test('boolean: "false" string is false', () => {
    expect(CastRegistry.get('boolean', 'false')).toBe(false)
  })
  test('boolean: "0" string is false', () => {
    expect(CastRegistry.get('boolean', '0')).toBe(false)
  })
  test('boolean: 1 is true', () => {
    expect(CastRegistry.get('boolean', 1)).toBe(true)
  })
  test('bool alias works', () => {
    expect(CastRegistry.get('bool', true)).toBe(true)
  })

  // ─── date ───────────────────────────────────────────────────────────────
  test('date: ISO string returns Date', () => {
    const d = CastRegistry.get('date', '2024-01-15T00:00:00Z')
    expect(d).toBeInstanceOf(Date)
    expect(d.getFullYear()).toBe(2024)
  })
  test('date: Date passthrough', () => {
    const now = new Date()
    expect(CastRegistry.get('date', now)).toBe(now)
  })
  test('date: serialize returns ISO string', () => {
    const d = new Date('2024-06-01T00:00:00.000Z')
    expect(CastRegistry.serialize('date', d)).toBe('2024-06-01T00:00:00.000Z')
  })
  test('datetime alias works', () => {
    const d = CastRegistry.get('datetime', '2024-01-01')
    expect(d).toBeInstanceOf(Date)
  })

  // ─── json ────────────────────────────────────────────────────────────────
  test('json: parse string to object', () => {
    const obj = CastRegistry.get('json', '{"a":1}')
    expect(obj).toEqual({ a: 1 })
  })
  test('json: object passthrough', () => {
    const obj = { x: 1 }
    expect(CastRegistry.get('json', obj)).toBe(obj)
  })
  test('json: set serializes object to string', () => {
    const val = CastRegistry.set('json', { b: 2 })
    expect(val).toBe('{"b":2}')
  })
  test('json: set passthrough for string', () => {
    expect(CastRegistry.set('json', '{"c":3}')).toBe('{"c":3}')
  })
  test('json: serialize parses stored string to object', () => {
    expect(CastRegistry.serialize('json', '{"d":4}')).toEqual({ d: 4 })
  })
  test('array alias works', () => {
    expect(CastRegistry.get('array', '[1,2,3]')).toEqual([1, 2, 3])
  })

  // ─── decimal:N ────────────────────────────────────────────────────────────
  test('decimal:2 rounds to 2 places', () => {
    expect(CastRegistry.get('decimal:2', 3.14159)).toBeCloseTo(3.14)
  })
  test('decimal:2 string input', () => {
    expect(CastRegistry.get('decimal:2', '9.999')).toBeCloseTo(10.0)
  })
  test('decimal:2 null passthrough', () => {
    expect(CastRegistry.get('decimal:2', null)).toBeNull()
  })

  // ─── no type ─────────────────────────────────────────────────────────────
  test('no type returns value unchanged', () => {
    expect(CastRegistry.get(null, 'hello')).toBe('hello')
    expect(CastRegistry.get(undefined, 99)).toBe(99)
  })

  // ─── Custom cast class ────────────────────────────────────────────────────
  test('class-based custom cast', () => {
    class UpperCast {
      get(v)       { return v?.toUpperCase() }
      set(v)       { return v?.toLowerCase() }
      serialize(v) { return v?.toUpperCase() }
    }

    expect(CastRegistry.get(UpperCast, 'hello')).toBe('HELLO')
    expect(CastRegistry.set(UpperCast, 'HELLO')).toBe('hello')
    expect(CastRegistry.serialize(UpperCast, 'world')).toBe('WORLD')
  })

  // ─── Registered custom cast ───────────────────────────────────────────────
  test('registered global custom cast', () => {
    class PrefixCast {
      get(v)  { return v ? `[PREFIX] ${v}` : v }
      set(v)  { return v?.replace('[PREFIX] ', '') ?? v }
      serialize(v) { return v }
    }

    CastRegistry.register('prefix', PrefixCast)

    expect(CastRegistry.get('prefix', 'hello')).toBe('[PREFIX] hello')
    expect(CastRegistry.set('prefix', '[PREFIX] hello')).toBe('hello')
  })

  // ─── Convenience cast classes ─────────────────────────────────────────────
  test('DateCast class', () => {
    const cast = new DateCast()
    expect(cast.get('2024-01-01')).toBeInstanceOf(Date)
  })

  test('JsonCast class', () => {
    const cast = new JsonCast()
    expect(cast.get('{"x":1}')).toEqual({ x: 1 })
    expect(cast.set({ y: 2 })).toBe('{"y":2}')
  })

  test('BooleanCast class', () => {
    const cast = new BooleanCast()
    expect(cast.get('0')).toBe(false)
    expect(cast.get('1')).toBe(true)
    expect(cast.set(true)).toBe(true)
  })
})
