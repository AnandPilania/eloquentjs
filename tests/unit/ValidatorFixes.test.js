/**
 * Regression tests for the validator defects: pipe syntax, rule-parameter
 * truncation at the first colon, numeric min/max on string input, the no-op
 * `nullable`, silently-ignored unknown rules, and the fail-open unique/exists.
 */

import { Validator as CoreValidator, Model, DB, setResolver, clearResolvers } from '../../packages/core/src/index.js'
import { Validator } from '../../packages/validator/src/Validator.js'
import { Rule } from '../../packages/validator/src/Rule.js'
import { SQLiteResolver } from '../../packages/sqlite/src/index.js'

let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}

describe.each([
  ['core', CoreValidator],
  ['validator package', Validator],
])('%s Validator', (_label, V) => {
  test('pipe syntax is parsed, not iterated character by character', () => {
    const v = V.make({ email: 'nope' }, { email: 'required|email' })
    expect(v.fails()).toBe(true)
    expect(v.errors.email[0]).toMatch(/valid email/)

    expect(V.make({ email: 'a@b.co' }, { email: 'required|email' }).passes()).toBe(true)
  })

  test('rule parameters keep every colon after the first', () => {
    // 'regex:^a:b$' used to compile /^a/ and silently accept anything.
    expect(V.make({ code: 'a:b' }, { code: ['regex:^a:b$'] }).passes()).toBe(true)
    expect(V.make({ code: 'ax' }, { code: ['regex:^a:b$'] }).fails()).toBe(true)
  })

  test('date_format handles formats containing colons', () => {
    expect(V.make({ t: '09:30' }, { t: ['date_format:H:i'] }).passes()).toBe(true)
    expect(V.make({ t: '9:3' }, { t: ['date_format:H:i'] }).fails()).toBe(true)
  })

  test('min/max compare numerically for numeric fields given string input', () => {
    // Query strings and form bodies are always strings; comparing '20'.length
    // against 18 is the wrong question.
    expect(V.make({ age: '20' }, { age: ['integer', 'min:18'] }).passes()).toBe(true)
    expect(V.make({ age: '17' }, { age: ['integer', 'min:18'] }).fails()).toBe(true)
    expect(V.make({ age: '200' }, { age: ['numeric', 'max:100'] }).fails()).toBe(true)
  })

  test('min/max still compare length for string fields', () => {
    expect(V.make({ name: 'ab' }, { name: ['string', 'min:2'] }).passes()).toBe(true)
    expect(V.make({ name: 'a' }, { name: ['string', 'min:2'] }).fails()).toBe(true)
  })

  test('nullable actually skips the remaining rules', () => {
    // `nullable` used to return null mid-switch and let 'email' run anyway.
    expect(V.make({ email: null }, { email: ['nullable', 'email'] }).passes()).toBe(true)
    expect(V.make({ email: '' }, { email: ['nullable', 'email'] }).passes()).toBe(true)
    expect(V.make({ email: 'nope' }, { email: ['nullable', 'email'] }).fails()).toBe(true)
    // nullable does not defeat required
    expect(V.make({ email: null }, { email: ['nullable', 'required'] }).fails()).toBe(true)
  })

  test('an unknown rule name throws instead of silently passing', () => {
    expect(() => V.make({ name: 'x' }, { name: ['requird'] }).validate()).toThrow(/Unknown validation rule/)
  })

  test('function rules still work', () => {
    const failing = V.make({ n: 3 }, { n: [(f, val) => (val < 5 ? 'too small' : null)] })
    expect(failing.fails()).toBe(true)
    expect(failing.errors.n).toEqual(['too small'])

    expect(V.make({ n: 9 }, { n: [(f, val) => (val < 5 ? 'too small' : null)] }).passes()).toBe(true)
  })
})

describe('validator package extras', () => {
  test('wildcard paths are expanded to the concrete rows', () => {
    const v = Validator.make(
      { items: [{ price: 10 }, { price: 'nope' }] },
      { 'items.*.price': ['required', 'numeric'] },
    )
    expect(v.fails()).toBe(true)
    expect(Object.keys(v.errors)).toEqual(['items.1.price'])
  })

  test('wildcard paths pass when every row is valid', () => {
    const v = Validator.make(
      { items: [{ price: 10 }, { price: '4.5' }] },
      { 'items.*.price': ['required', 'numeric'] },
    )
    expect(v.passes()).toBe(true)
  })

  test('ipv4 rejects out-of-range octets', () => {
    expect(Validator.make({ ip: '999.999.999.999' }, { ip: ['ipv4'] }).fails()).toBe(true)
    expect(Validator.make({ ip: '10.0.0.1' }, { ip: ['ipv4'] }).passes()).toBe(true)
  })

  test('before/after accept another field name', () => {
    const v = Validator.make(
      { starts: '2026-01-01', ends: '2025-01-01' },
      { ends: ['after:starts'] },
    )
    expect(v.fails()).toBe(true)
    expect(Validator.make(
      { starts: '2025-01-01', ends: '2026-01-01' },
      { ends: ['after:starts'] },
    ).passes()).toBe(true)
  })

  test('field names with regex metacharacters do not break message formatting', () => {
    // The old implementation ran new RegExp(field) over the message.
    const v = Validator.make({ 'a.b(c)': '' }, { 'a.b(c)': ['required'] })
    expect(v.fails()).toBe(true)
    expect(typeof v.errors['a.b(c)'][0]).toBe('string')
  })

  test('after() hooks can add errors', () => {
    const v = Validator.make({ n: 1 }, { n: ['numeric'] })
      .after(val => val.addError('n', 'business rule failed'))
    expect(v.passes()).toBe(false)
    expect(v.errors.n).toEqual(['business rule failed'])
  })
})

const describeIf = DatabaseSync ? describe : describe.skip

describeIf('unique / exists hit the database (real SQL)', () => {
  let db

  class User extends Model {
    static table = 'users'
    static fillable = ['email']
    static timestamps = false
  }

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    clearResolvers()
    setResolver(new SQLiteResolver(db))
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT)')
    await User.create({ email: 'taken@example.com' })
  })

  afterEach(() => { db?.close?.(); clearResolvers() })

  test('unique:table,column rejects a duplicate', async () => {
    const v = Validator.make({ email: 'taken@example.com' }, { email: ['required', 'unique:users,email'] })
    expect(await v.failsAsync()).toBe(true)
    expect(v.errors.email[0]).toMatch(/already been taken/)
  })

  test('unique:table,column accepts a free value', async () => {
    const v = Validator.make({ email: 'free@example.com' }, { email: ['required', 'unique:users,email'] })
    expect(await v.passesAsync()).toBe(true)
  })

  test('unique ignores the given id, for updates', async () => {
    const user = await User.first()
    const v = Validator.make(
      { email: 'taken@example.com' },
      { email: [`unique:users,email,${user.id},id`] },
    )
    expect(await v.passesAsync()).toBe(true)
  })

  test('Rule.unique() works and no longer fails open', async () => {
    const v = Validator.make(
      { email: 'taken@example.com' },
      { email: ['required', Rule.unique('users', 'email')] },
    )
    expect(await v.failsAsync()).toBe(true)
  })

  test('Rule.unique().ignore() allows the record to keep its own value', async () => {
    const user = await User.first()
    const v = Validator.make(
      { email: 'taken@example.com' },
      { email: [Rule.unique('users', 'email').ignore(user.id)] },
    )
    expect(await v.passesAsync()).toBe(true)
  })

  test('exists rejects a missing row and accepts a present one', async () => {
    const user = await User.first()
    expect(await Validator.make({ id: 9999 }, { id: ['exists:users,id'] }).failsAsync()).toBe(true)
    expect(await Validator.make({ id: user.id }, { id: ['exists:users,id'] }).passesAsync()).toBe(true)
  })

  test('a database error surfaces instead of silently passing', async () => {
    const v = Validator.make({ email: 'x@y.z' }, { email: ['unique:nonexistent_table,email'] })
    await expect(v.validateAsync()).rejects.toThrow()
  })

  test('the sync path does not claim unique passed', () => {
    // unique is skipped, not reported as satisfied — callers must use validateAsync().
    const v = Validator.make({ email: 'taken@example.com' }, { email: ['unique:users,email'] })
    expect(v.passes()).toBe(true)   // no verdict from a sync run
    expect(DB.inTransaction()).toBe(false)
  })
})
