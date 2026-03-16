/**
 * Unit tests — Validator
 */

import { Validator } from '../../packages/core/src/Validator.js'

describe('Validator', () => {
  // ─── required ─────────────────────────────────────────────────────────────
  test('required: fails on missing field', () => {
    const v = Validator.make({}, { name: ['required'] })
    expect(v.fails()).toBe(true)
    expect(v.errors.name).toBeDefined()
  })

  test('required: fails on empty string', () => {
    const v = Validator.make({ name: '' }, { name: ['required'] })
    expect(v.fails()).toBe(true)
  })

  test('required: fails on null', () => {
    const v = Validator.make({ name: null }, { name: ['required'] })
    expect(v.fails()).toBe(true)
  })

  test('required: passes when present', () => {
    const v = Validator.make({ name: 'Alice' }, { name: ['required'] })
    expect(v.passes()).toBe(true)
  })

  // ─── string ───────────────────────────────────────────────────────────────
  test('string: fails on non-string', () => {
    const v = Validator.make({ name: 123 }, { name: ['string'] })
    expect(v.fails()).toBe(true)
  })

  test('string: passes on string', () => {
    const v = Validator.make({ name: 'Alice' }, { name: ['string'] })
    expect(v.passes()).toBe(true)
  })

  test('string: passes on null (not required)', () => {
    const v = Validator.make({ name: null }, { name: ['string'] })
    expect(v.passes()).toBe(true)
  })

  // ─── integer ──────────────────────────────────────────────────────────────
  test('integer: fails on float string', () => {
    const v = Validator.make({ age: '3.5' }, { age: ['integer'] })
    expect(v.fails()).toBe(true)
  })

  test('integer: passes on integer string', () => {
    const v = Validator.make({ age: '25' }, { age: ['integer'] })
    expect(v.passes()).toBe(true)
  })

  test('integer: passes on actual number', () => {
    const v = Validator.make({ age: 25 }, { age: ['integer'] })
    expect(v.passes()).toBe(true)
  })

  // ─── numeric ──────────────────────────────────────────────────────────────
  test('numeric: fails on non-numeric string', () => {
    const v = Validator.make({ price: 'abc' }, { price: ['numeric'] })
    expect(v.fails()).toBe(true)
  })

  test('numeric: passes on float', () => {
    const v = Validator.make({ price: '9.99' }, { price: ['numeric'] })
    expect(v.passes()).toBe(true)
  })

  // ─── email ────────────────────────────────────────────────────────────────
  test('email: fails on invalid', () => {
    const v = Validator.make({ email: 'notanemail' }, { email: ['email'] })
    expect(v.fails()).toBe(true)
  })

  test('email: passes on valid', () => {
    const v = Validator.make({ email: 'user@example.com' }, { email: ['email'] })
    expect(v.passes()).toBe(true)
  })

  // ─── min / max ────────────────────────────────────────────────────────────
  test('min:2 string length fails', () => {
    const v = Validator.make({ name: 'A' }, { name: ['min:2'] })
    expect(v.fails()).toBe(true)
  })

  test('min:2 string length passes', () => {
    const v = Validator.make({ name: 'Al' }, { name: ['min:2'] })
    expect(v.passes()).toBe(true)
  })

  test('min:18 numeric fails', () => {
    const v = Validator.make({ age: 16 }, { age: ['numeric', 'min:18'] })
    expect(v.fails()).toBe(true)
  })

  test('max:5 string length fails', () => {
    const v = Validator.make({ code: 'TOOLONG' }, { code: ['max:5'] })
    expect(v.fails()).toBe(true)
  })

  // ─── in ───────────────────────────────────────────────────────────────────
  test('in: fails when value not in list', () => {
    const v = Validator.make({ role: 'superadmin' }, { role: ['in:admin,editor,viewer'] })
    expect(v.fails()).toBe(true)
  })

  test('in: passes when value in list', () => {
    const v = Validator.make({ role: 'admin' }, { role: ['in:admin,editor,viewer'] })
    expect(v.passes()).toBe(true)
  })

  // ─── not_in ───────────────────────────────────────────────────────────────
  test('not_in: fails when value in banned list', () => {
    const v = Validator.make({ status: 'banned' }, { status: ['not_in:banned,deleted'] })
    expect(v.fails()).toBe(true)
  })

  // ─── boolean ─────────────────────────────────────────────────────────────
  test('boolean: passes for 0/1 strings', () => {
    expect(Validator.make({ f: '0' }, { f: ['boolean'] }).passes()).toBe(true)
    expect(Validator.make({ f: '1' }, { f: ['boolean'] }).passes()).toBe(true)
  })

  test('boolean: fails for random string', () => {
    expect(Validator.make({ f: 'yes' }, { f: ['boolean'] }).fails()).toBe(true)
  })

  // ─── array ───────────────────────────────────────────────────────────────
  test('array: fails on non-array', () => {
    const v = Validator.make({ tags: 'foo' }, { tags: ['array'] })
    expect(v.fails()).toBe(true)
  })

  test('array: passes on array', () => {
    const v = Validator.make({ tags: ['a', 'b'] }, { tags: ['array'] })
    expect(v.passes()).toBe(true)
  })

  // ─── between ─────────────────────────────────────────────────────────────
  test('between: fails outside range', () => {
    const v = Validator.make({ score: 5 }, { score: ['between:10,100'] })
    expect(v.fails()).toBe(true)
  })

  test('between: passes inside range', () => {
    const v = Validator.make({ score: 50 }, { score: ['between:10,100'] })
    expect(v.passes()).toBe(true)
  })

  // ─── confirmed ────────────────────────────────────────────────────────────
  test('confirmed: fails when mismatch', () => {
    const v = Validator.make(
      { password: 'abc', password_confirmation: 'xyz' },
      { password: ['confirmed'] }
    )
    expect(v.fails()).toBe(true)
  })

  test('confirmed: passes when matching', () => {
    const v = Validator.make(
      { password: 'abc', password_confirmation: 'abc' },
      { password: ['confirmed'] }
    )
    expect(v.passes()).toBe(true)
  })

  // ─── custom function rule ─────────────────────────────────────────────────
  test('custom function rule: returning error string fails', () => {
    const rule = (field, value) => value !== 'magic' ? `${field} must be magic` : null
    const v = Validator.make({ token: 'wrong' }, { token: [rule] })
    expect(v.fails()).toBe(true)
    expect(v.errors.token[0]).toContain('magic')
  })

  test('custom function rule: returning null passes', () => {
    const rule = (field, value) => value === 'magic' ? null : 'bad'
    const v = Validator.make({ token: 'magic' }, { token: [rule] })
    expect(v.passes()).toBe(true)
  })

  // ─── multiple rules ───────────────────────────────────────────────────────
  test('multiple rules: stops at first failure', () => {
    const v = Validator.make({ name: '' }, { name: ['required', 'min:2', 'max:100'] })
    expect(v.fails()).toBe(true)
    expect(v.errors.name).toHaveLength(1)
  })

  // ─── validated() ─────────────────────────────────────────────────────────
  test('validated() returns only rule-defined fields', () => {
    const v = Validator.make(
      { name: 'Alice', extra: 'noise' },
      { name: ['required'] }
    )
    const result = v.validated()
    expect(result).toHaveProperty('name', 'Alice')
    expect(result).not.toHaveProperty('extra')
  })

  test('validated() throws if validation fails', () => {
    const v = Validator.make({}, { name: ['required'] })
    expect(() => v.validated()).toThrow()
  })

  // ─── custom messages ─────────────────────────────────────────────────────
  test('custom messages override defaults', () => {
    const v = Validator.make(
      { name: '' },
      { name: ['required'] },
      { 'name.required': 'Name is mandatory!' }
    )
    v.fails()
    expect(v.errors.name[0]).toBe('Name is mandatory!')
  })

  // ─── url ─────────────────────────────────────────────────────────────────
  test('url: fails on invalid URL', () => {
    const v = Validator.make({ link: 'not-a-url' }, { link: ['url'] })
    expect(v.fails()).toBe(true)
  })

  test('url: passes on valid URL', () => {
    const v = Validator.make({ link: 'https://example.com' }, { link: ['url'] })
    expect(v.passes()).toBe(true)
  })

  // ─── date ─────────────────────────────────────────────────────────────────
  test('date: fails on invalid date string', () => {
    const v = Validator.make({ dob: 'not-a-date' }, { dob: ['date'] })
    expect(v.fails()).toBe(true)
  })

  test('date: passes on valid date string', () => {
    const v = Validator.make({ dob: '1990-05-20' }, { dob: ['date'] })
    expect(v.passes()).toBe(true)
  })
})
