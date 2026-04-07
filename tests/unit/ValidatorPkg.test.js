/**
 * @eloquentjs/validator — Unit Tests
 *
 * Tests the extended Validator, Schema (fluent API), Rule objects,
 * and named rule functions. No DB or HTTP deps needed.
 */

import { jest } from '@jest/globals'

const { Validator, validate, validateAsync } =
  await import('../../packages/validator/src/Validator.js')

const { v, Schema, StringSchema, NumberSchema } =
  await import('../../packages/validator/src/Schema.js')

const { Rule, UniqueRule, ExistsRule } =
  await import('../../packages/validator/src/Rule.js')

const rules = await import('../../packages/validator/src/rules/index.js')

const { ValidationException } =
  await import('../../packages/core/src/errors.js')

// ─────────────────────────────────────────────────────────────────────────────
// Extended Validator — new rules
// ─────────────────────────────────────────────────────────────────────────────
describe('Validator — new rules', () => {

  // prohibited
  test('prohibited: fails when value present', () => {
    const v = Validator.make({ admin: true }, { admin: ['prohibited'] })
    expect(v.fails()).toBe(true)
  })
  test('prohibited: passes when value absent', () => {
    const v = Validator.make({}, { admin: ['prohibited'] })
    expect(v.passes()).toBe(true)
  })

  // required_with
  test('required_with: fails when companion present and field empty', () => {
    const v = Validator.make({ city: 'NYC' }, { zip: ['required_with:city'] })
    expect(v.fails()).toBe(true)
  })
  test('required_with: passes when companion absent', () => {
    const v = Validator.make({}, { zip: ['required_with:city'] })
    expect(v.passes()).toBe(true)
  })
  test('required_with: passes when companion present and field provided', () => {
    const v = Validator.make({ city: 'NYC', zip: '10001' }, { zip: ['required_with:city'] })
    expect(v.passes()).toBe(true)
  })

  // required_without
  test('required_without: fails when companion absent and field empty', () => {
    const v = Validator.make({}, { phone: ['required_without:email'] })
    expect(v.fails()).toBe(true)
  })
  test('required_without: passes when companion present', () => {
    const v = Validator.make({ email: 'a@b.com' }, { phone: ['required_without:email'] })
    expect(v.passes()).toBe(true)
  })

  // required_without_all
  test('required_without_all: fails when all companions absent', () => {
    const v = Validator.make({}, { contact: ['required_without_all:email,phone'] })
    expect(v.fails()).toBe(true)
  })
  test('required_without_all: passes when one companion present', () => {
    const v = Validator.make({ email: 'a@b.com' }, { contact: ['required_without_all:email,phone'] })
    expect(v.passes()).toBe(true)
  })

  // alpha
  test('alpha: passes on letters only', () => {
    expect(Validator.make({ name: 'Alice' }, { name: ['alpha'] }).passes()).toBe(true)
  })
  test('alpha: fails on letters + numbers', () => {
    expect(Validator.make({ name: 'Alice1' }, { name: ['alpha'] }).fails()).toBe(true)
  })

  // alpha_num
  test('alpha_num: passes on alphanumeric', () => {
    expect(Validator.make({ slug: 'abc123' }, { slug: ['alpha_num'] }).passes()).toBe(true)
  })
  test('alpha_num: fails on special chars', () => {
    expect(Validator.make({ slug: 'abc-123' }, { slug: ['alpha_num'] }).fails()).toBe(true)
  })

  // alpha_dash
  test('alpha_dash: passes on letters, numbers, dashes, underscores', () => {
    expect(Validator.make({ slug: 'abc_123-xyz' }, { slug: ['alpha_dash'] }).passes()).toBe(true)
  })
  test('alpha_dash: fails on spaces', () => {
    expect(Validator.make({ slug: 'abc xyz' }, { slug: ['alpha_dash'] }).fails()).toBe(true)
  })

  // starts_with
  test('starts_with: passes when value starts with prefix', () => {
    const v = Validator.make({ code: 'US-123' }, { code: ['starts_with:US'] })
    expect(v.passes()).toBe(true)
  })
  test('starts_with: fails when value does not start with prefix', () => {
    const v = Validator.make({ code: 'GB-123' }, { code: ['starts_with:US'] })
    expect(v.fails()).toBe(true)
  })

  // ends_with
  test('ends_with: passes when value ends with suffix', () => {
    const v = Validator.make({ file: 'image.jpg' }, { file: ['ends_with:.jpg,.png'] })
    expect(v.passes()).toBe(true)
  })

  // uuid
  test('uuid: passes on valid UUID', () => {
    const v = Validator.make({ id: '550e8400-e29b-41d4-a716-446655440000' }, { id: ['uuid'] })
    expect(v.passes()).toBe(true)
  })
  test('uuid: fails on invalid UUID', () => {
    const v = Validator.make({ id: 'not-a-uuid' }, { id: ['uuid'] })
    expect(v.fails()).toBe(true)
  })

  // ip
  test('ip: passes on valid IPv4', () => {
    expect(Validator.make({ ip: '192.168.1.1' }, { ip: ['ip'] }).passes()).toBe(true)
  })
  test('ip: fails on invalid IP', () => {
    expect(Validator.make({ ip: 'not-an-ip' }, { ip: ['ip'] }).fails()).toBe(true)
  })

  // json
  test('json: passes on valid JSON string', () => {
    const v = Validator.make({ meta: '{"key":"value"}' }, { meta: ['json'] })
    expect(v.passes()).toBe(true)
  })
  test('json: fails on invalid JSON string', () => {
    const v = Validator.make({ meta: '{invalid}' }, { meta: ['json'] })
    expect(v.fails()).toBe(true)
  })

  // timezone
  test('timezone: passes on valid timezone', () => {
    const v = Validator.make({ tz: 'America/New_York' }, { tz: ['timezone'] })
    expect(v.passes()).toBe(true)
  })
  test('timezone: fails on invalid timezone', () => {
    const v = Validator.make({ tz: 'Invalid/Zone' }, { tz: ['timezone'] })
    expect(v.fails()).toBe(true)
  })

  // digits
  test('digits: passes on correct digit length', () => {
    const v = Validator.make({ pin: '1234' }, { pin: ['digits:4'] })
    expect(v.passes()).toBe(true)
  })
  test('digits: fails on wrong length', () => {
    const v = Validator.make({ pin: '123' }, { pin: ['digits:4'] })
    expect(v.fails()).toBe(true)
  })
  test('digits: fails on non-numeric', () => {
    const v = Validator.make({ pin: 'abcd' }, { pin: ['digits:4'] })
    expect(v.fails()).toBe(true)
  })

  // size
  test('size: passes on exact length string', () => {
    const v = Validator.make({ code: 'US' }, { code: ['size:2'] })
    expect(v.passes()).toBe(true)
  })
  test('size: fails on wrong length', () => {
    const v = Validator.make({ code: 'USA' }, { code: ['size:2'] })
    expect(v.fails()).toBe(true)
  })

  // before / after
  test('before: passes when date before boundary', () => {
    const v = Validator.make({ dob: '1990-01-01' }, { dob: ['before:2000-01-01'] })
    expect(v.passes()).toBe(true)
  })
  test('before: fails when date after boundary', () => {
    const v = Validator.make({ dob: '2010-01-01' }, { dob: ['before:2000-01-01'] })
    expect(v.fails()).toBe(true)
  })
  test('after: passes when date after boundary', () => {
    const v = Validator.make({ date: '2030-01-01' }, { date: ['after:2020-01-01'] })
    expect(v.passes()).toBe(true)
  })

  // gt / lt
  test('gt: fails when value not greater than other field', () => {
    const v = Validator.make({ max: 5, min: 10 }, { max: ['gt:min'] })
    expect(v.fails()).toBe(true)
  })
  test('gt: passes when value greater than other field', () => {
    const v = Validator.make({ max: 15, min: 10 }, { max: ['gt:min'] })
    expect(v.passes()).toBe(true)
  })

  // mac_address
  test('mac_address: passes on valid MAC', () => {
    const v = Validator.make({ mac: '00:1A:2B:3C:4D:5E' }, { mac: ['mac_address'] })
    expect(v.passes()).toBe(true)
  })
  test('mac_address: fails on invalid MAC', () => {
    const v = Validator.make({ mac: 'not-a-mac' }, { mac: ['mac_address'] })
    expect(v.fails()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Validator — bail, sometimes, custom attributes
// ─────────────────────────────────────────────────────────────────────────────
describe('Validator — bail / sometimes / attributes', () => {
  test('bail() stops after first field failure', () => {
    const v = Validator.make(
      { name: '', email: '' },
      { name: ['required'], email: ['required'] }
    ).bail()
    v.validate()
    // Should stop at first failing field
    expect(Object.keys(v.errors).length).toBe(1)
  })

  test('sometimes() skips validation when field absent', () => {
    const v = Validator.make({}, { phone: ['string', 'min:10'] }).sometimes('phone')
    expect(v.passes()).toBe(true)
  })

  test('sometimes() validates when field is present', () => {
    const v = Validator.make({ phone: 'abc' }, { phone: ['min:10'] }).sometimes('phone')
    expect(v.fails()).toBe(true)
  })

  test('custom attributes replace field name in error messages', () => {
    const v = Validator.make(
      { usr_email: '' },
      { usr_email: ['required'] },
      {},
      { usr_email: 'email address' }
    )
    v.validate()
    expect(v.errors.usr_email[0]).toContain('email address')
    expect(v.errors.usr_email[0]).not.toContain('usr email')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Validator — nested dot-notation
// ─────────────────────────────────────────────────────────────────────────────
describe('Validator — nested fields', () => {
  test('validates nested field address.city', () => {
    const v = Validator.make(
      { address: { city: '' } },
      { 'address.city': ['required', 'string'] }
    )
    expect(v.fails()).toBe(true)
    expect(v.errors['address.city']).toBeDefined()
  })

  test('passes when nested field valid', () => {
    const v = Validator.make(
      { address: { city: 'New York', zip: '10001' } },
      { 'address.city': ['required', 'string'], 'address.zip': ['required', 'digits:5'] }
    )
    expect(v.passes()).toBe(true)
  })

  test('deeply nested field user.profile.bio', () => {
    const v = Validator.make(
      { user: { profile: { bio: '' } } },
      { 'user.profile.bio': ['required'] }
    )
    expect(v.fails()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Validator — async (no DB — custom async Rule objects)
// ─────────────────────────────────────────────────────────────────────────────
describe('Validator — async', () => {
  class EvenNumberRule extends Rule {
    message() { return 'The :field must be an even number.' }
    async passesAsync(field, value) {
      await new Promise(r => setTimeout(r, 1)) // simulate async
      return Number(value) % 2 === 0
    }
  }

  test('validateAsync() passes with valid async rule', async () => {
    const v = Validator.make({ count: 4 }, { count: ['required', new EvenNumberRule()] })
    expect(await v.passesAsync()).toBe(true)
  })

  test('validateAsync() fails with invalid async rule', async () => {
    const v = Validator.make({ count: 3 }, { count: ['required', new EvenNumberRule()] })
    expect(await v.failsAsync()).toBe(true)
    expect(v.errors.count).toBeDefined()
  })

  test('validatedAsync() returns validated data on success', async () => {
    const v = Validator.make({ count: 4, extra: 'ignored' }, { count: ['required', new EvenNumberRule()] })
    const result = await v.validatedAsync()
    expect(result.count).toBe(4)
    expect(result.extra).toBeUndefined()
  })

  test('validatedAsync() throws ValidationException on failure', async () => {
    const v = Validator.make({ count: 3 }, { count: ['required', new EvenNumberRule()] })
    await expect(v.validatedAsync()).rejects.toThrow(ValidationException)
  })

  test('validateAsync function shorthand throws on failure', async () => {
    await expect(
      validateAsync({ name: '' }, { name: ['required'] })
    ).rejects.toThrow(ValidationException)
  })

  test('validateAsync function shorthand returns data on success', async () => {
    const result = await validateAsync({ name: 'Alice' }, { name: ['required'] })
    expect(result.name).toBe('Alice')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rule base class
// ─────────────────────────────────────────────────────────────────────────────
describe('Rule base class', () => {
  test('Rule.passes() returns true by default', () => {
    const rule = new Rule()
    expect(rule.passes('field', 'value', {})).toBe(true)
  })

  test('Rule.formatMessage substitutes :field and :value', () => {
    class TestRule extends Rule {
      message() { return 'The :field ":value" is invalid.' }
    }
    const rule = new TestRule()
    expect(rule.formatMessage('email', 'bad@')).toBe('The email "bad@" is invalid.')
  })

  test('Rule.unique factory creates UniqueRule', () => {
    const rule = Rule.unique('users', 'email')
    expect(rule).toBeInstanceOf(UniqueRule)
    expect(rule.table).toBe('users')
    expect(rule.column).toBe('email')
  })

  test('Rule.exists factory creates ExistsRule', () => {
    const rule = Rule.exists('roles', 'id')
    expect(rule).toBeInstanceOf(ExistsRule)
    expect(rule.table).toBe('roles')
    expect(rule.column).toBe('id')
  })

  test('UniqueRule.ignore() sets ignoreId', () => {
    const rule = Rule.unique('users', 'email').ignore(42, 'id')
    expect(rule._ignoreId).toBe(42)
    expect(rule._ignoreCol).toBe('id')
  })

  test('UniqueRule.where() adds extra conditions', () => {
    const rule = Rule.unique('users', 'email').where('tenant_id', 1)
    expect(rule._where).toEqual([['tenant_id', 1]])
  })

  test('custom Rule subclass: sync fail', () => {
    class NoSpaces extends Rule {
      message() { return ':field cannot contain spaces.' }
      passes(field, value) { return !String(value).includes(' ') }
    }
    const vld = Validator.make({ name: 'John Doe' }, { name: ['required', new NoSpaces()] })
    expect(vld.fails()).toBe(true)
    expect(vld.errors.name[0]).toContain('name cannot contain spaces')
  })

  test('custom Rule subclass: sync pass', () => {
    class NoSpaces extends Rule {
      message() { return ':field cannot contain spaces.' }
      passes(field, value) { return !String(value).includes(' ') }
    }
    const vld = Validator.make({ name: 'JohnDoe' }, { name: ['required', new NoSpaces()] })
    expect(vld.passes()).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fluent Schema API — v.string()
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema API — v.string()', () => {
  test('required by default', () => {
    const schema = v.schema({ name: v.string() })
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
    expect(result.errors.name).toBeDefined()
  })

  test('optional() allows missing field', () => {
    const schema = v.schema({ bio: v.string().optional() })
    expect(schema.safeParse({}).success).toBe(true)
  })

  test('.email() validates email format', () => {
    const schema = v.schema({ email: v.string().email() })
    expect(schema.safeParse({ email: 'not-an-email' }).success).toBe(false)
    expect(schema.safeParse({ email: 'a@b.com' }).success).toBe(true)
  })

  test('.min() validates minimum length', () => {
    const schema = v.schema({ name: v.string().min(3) })
    expect(schema.safeParse({ name: 'ab' }).success).toBe(false)
    expect(schema.safeParse({ name: 'abc' }).success).toBe(true)
  })

  test('.max() validates maximum length', () => {
    const schema = v.schema({ name: v.string().max(5) })
    expect(schema.safeParse({ name: 'toolong' }).success).toBe(false)
    expect(schema.safeParse({ name: 'ok' }).success).toBe(true)
  })

  test('.url() validates URL format', () => {
    const schema = v.schema({ site: v.string().url() })
    expect(schema.safeParse({ site: 'not-a-url' }).success).toBe(false)
    expect(schema.safeParse({ site: 'https://example.com' }).success).toBe(true)
  })

  test('.uuid() validates UUID format', () => {
    const schema = v.schema({ id: v.string().uuid() })
    expect(schema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
    expect(schema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(true)
  })

  test('.oneOf() validates allowed values', () => {
    const schema = v.schema({ role: v.string().oneOf(['admin', 'editor', 'viewer']) })
    expect(schema.safeParse({ role: 'hacker' }).success).toBe(false)
    expect(schema.safeParse({ role: 'admin' }).success).toBe(true)
  })

  test('.regex() validates pattern', () => {
    const schema = v.schema({ code: v.string().regex(/^[A-Z]{2}-\d{4}$/) })
    expect(schema.safeParse({ code: 'US-1234' }).success).toBe(true)
    expect(schema.safeParse({ code: 'us-1234' }).success).toBe(false)
  })

  test('.confirmed() validates confirmation field', () => {
    const schema = v.schema({ password: v.string().min(8).confirmed() })
    expect(schema.safeParse({ password: 'secret123', password_confirmation: 'secret123' }).success).toBe(true)
    expect(schema.safeParse({ password: 'secret123', password_confirmation: 'wrong' }).success).toBe(false)
  })

  test('.alpha() validates letters only', () => {
    const schema = v.schema({ name: v.string().alpha() })
    expect(schema.safeParse({ name: 'Alice' }).success).toBe(true)
    expect(schema.safeParse({ name: 'Alice1' }).success).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fluent Schema API — v.number()
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema API — v.number()', () => {
  test('validates numeric', () => {
    const schema = v.schema({ price: v.number() })
    expect(schema.safeParse({ price: 'abc' }).success).toBe(false)
    expect(schema.safeParse({ price: 9.99 }).success).toBe(true)
  })

  test('.integer() validates integer', () => {
    const schema = v.schema({ age: v.number().integer() })
    expect(schema.safeParse({ age: 3.5 }).success).toBe(false)
    expect(schema.safeParse({ age: 25 }).success).toBe(true)
  })

  test('.min() validates minimum value', () => {
    const schema = v.schema({ age: v.number().integer().min(18) })
    expect(schema.safeParse({ age: 17 }).success).toBe(false)
    expect(schema.safeParse({ age: 18 }).success).toBe(true)
  })

  test('.max() validates maximum value', () => {
    const schema = v.schema({ score: v.number().max(100) })
    expect(schema.safeParse({ score: 101 }).success).toBe(false)
    expect(schema.safeParse({ score: 100 }).success).toBe(true)
  })

  test('.between() validates range', () => {
    const schema = v.schema({ rating: v.number().between(1, 5) })
    expect(schema.safeParse({ rating: 6 }).success).toBe(false)
    expect(schema.safeParse({ rating: 3 }).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fluent Schema API — v.boolean(), v.date(), v.array()
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema API — boolean / date / array', () => {
  test('v.boolean() validates boolean', () => {
    const schema = v.schema({ active: v.boolean() })
    expect(schema.safeParse({ active: 'yes' }).success).toBe(false)
    expect(schema.safeParse({ active: true }).success).toBe(true)
  })

  test('v.date() validates date', () => {
    const schema = v.schema({ dob: v.date() })
    expect(schema.safeParse({ dob: 'not-a-date' }).success).toBe(false)
    expect(schema.safeParse({ dob: '1990-01-15' }).success).toBe(true)
  })

  test('v.date().after() validates after boundary', () => {
    const schema = v.schema({ start: v.date().after('2020-01-01') })
    expect(schema.safeParse({ start: '2019-12-31' }).success).toBe(false)
    expect(schema.safeParse({ start: '2021-01-01' }).success).toBe(true)
  })

  test('v.array() validates array type', () => {
    const schema = v.schema({ tags: v.array() })
    expect(schema.safeParse({ tags: 'not-array' }).success).toBe(false)
    expect(schema.safeParse({ tags: ['a', 'b'] }).success).toBe(true)
  })

  test('v.array().min() validates minimum items', () => {
    const schema = v.schema({ tags: v.array().min(1) })
    expect(schema.safeParse({ tags: [] }).success).toBe(false)
    expect(schema.safeParse({ tags: ['a'] }).success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fluent Schema API — v.object() with nested shape
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema API — v.object() nested', () => {
  test('validates nested object fields', () => {
    const schema = v.schema({
      address: v.object({
        city:    v.string(),
        country: v.string().length(2),
      }),
    })

    const result = schema.safeParse({
      address: { city: 'London', country: 'GB' }
    })
    expect(result.success).toBe(true)
  })

  test('fails on invalid nested field', () => {
    const schema = v.schema({
      address: v.object({
        city:    v.string(),
        country: v.string().length(2),
      }),
    })

    const result = schema.safeParse({
      address: { city: 'London', country: 'GBR' }  // 3 chars, should be 2
    })
    expect(result.success).toBe(false)
    expect(result.errors['address.country']).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Schema — parse / safeParse / parseAsync / safeParseAsync
// ─────────────────────────────────────────────────────────────────────────────
describe('Schema — parse methods', () => {
  const userSchema = v.schema({
    name:  v.string().min(2).max(100),
    email: v.string().email(),
    age:   v.number().integer().min(18).optional(),
  })

  test('parse() returns validated data on success', () => {
    const data = userSchema.parse({ name: 'Alice', email: 'alice@example.com', age: 25 })
    expect(data.name).toBe('Alice')
    expect(data.email).toBe('alice@example.com')
    expect(data.age).toBe(25)
  })

  test('parse() throws ValidationException on failure', () => {
    expect(() => userSchema.parse({ name: 'A', email: 'not-email' }))
      .toThrow(ValidationException)
  })

  test('parse() throws with structured errors', () => {
    try {
      userSchema.parse({ name: '', email: 'bad' })
    } catch (err) {
      expect(err.errors.name).toBeDefined()
      expect(err.errors.email).toBeDefined()
    }
  })

  test('safeParse() returns { success: true, data } on success', () => {
    const result = userSchema.safeParse({ name: 'Alice', email: 'a@b.com' })
    expect(result.success).toBe(true)
    expect(result.data.name).toBe('Alice')
    expect(result.errors).toEqual({})
  })

  test('safeParse() returns { success: false, errors } on failure', () => {
    const result = userSchema.safeParse({ name: 'A', email: 'bad' })
    expect(result.success).toBe(false)
    expect(result.data).toBeNull()
    expect(result.errors.email).toBeDefined()
  })

  test('parseAsync() returns validated data', async () => {
    const data = await userSchema.parseAsync({ name: 'Bob', email: 'bob@example.com' })
    expect(data.name).toBe('Bob')
  })

  test('safeParseAsync() returns result object', async () => {
    const result = await userSchema.safeParseAsync({ name: 'B', email: 'bad' })
    expect(result.success).toBe(false)
    expect(result.errors.email).toBeDefined()
  })

  test('toValidatorArgs() exports rules/messages', () => {
    const { rules: r, messages } = userSchema.toValidatorArgs()
    expect(r.name).toBeDefined()
    expect(r.email).toBeDefined()
    expect(Array.isArray(r.name)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Named rule functions
// ─────────────────────────────────────────────────────────────────────────────
describe('Named rule functions', () => {
  test('required() returns "required"', () => {
    expect(rules.required()).toBe('required')
  })

  test('email() returns "email"', () => {
    expect(rules.email()).toBe('email')
  })

  test('min(3) returns "min:3"', () => {
    expect(rules.min(3)).toBe('min:3')
  })

  test('max(100) returns "max:100"', () => {
    expect(rules.max(100)).toBe('max:100')
  })

  test('between(1, 10) returns "between:1,10"', () => {
    expect(rules.between(1, 10)).toBe('between:1,10')
  })

  test('inList() returns in: rule string', () => {
    expect(rules.inList('admin', 'editor')).toBe('in:admin,editor')
  })

  test('regex() works with RegExp', () => {
    expect(rules.regex(/^\d+$/)).toBe('regex:^\\d+$')
  })

  test('requiredWith() returns multi-field rule', () => {
    expect(rules.requiredWith('city', 'state')).toBe('required_with:city,state')
  })

  test('unique() returns UniqueRule object', () => {
    const rule = rules.unique('users', 'email')
    expect(rule).toBeInstanceOf(UniqueRule)
  })

  test('exists() returns ExistsRule object', () => {
    const rule = rules.exists('roles', 'id')
    expect(rule).toBeInstanceOf(ExistsRule)
  })

  test('emailRules() convenience group', () => {
    const r = rules.emailRules()
    expect(r).toContain('required')
    expect(r).toContain('email')
  })

  test('passwordRules() convenience group', () => {
    const r = rules.passwordRules()
    expect(r).toContain('required')
    expect(r.some(x => String(x).startsWith('min:'))).toBe(true)
  })

  test('named rules work in Validator.make()', () => {
    const v = Validator.make(
      { name: '', email: 'bad', age: 16 },
      {
        name:  [rules.required(), rules.string(), rules.min(2)],
        email: [rules.required(), rules.email()],
        age:   [rules.integer(), rules.min(18)],
      }
    )
    expect(v.fails()).toBe(true)
    expect(v.errors.name).toBeDefined()
    expect(v.errors.email).toBeDefined()
    expect(v.errors.age).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate() convenience shorthand
// ─────────────────────────────────────────────────────────────────────────────
describe('validate() shorthand', () => {
  test('returns validated data subset on success', () => {
    const data = validate(
      { name: 'Alice', extra: 'ignored' },
      { name: ['required', 'string'] }
    )
    expect(data.name).toBe('Alice')
    expect(data.extra).toBeUndefined()
  })

  test('throws ValidationException on failure', () => {
    expect(() => validate({ name: '' }, { name: ['required'] }))
      .toThrow(ValidationException)
  })

  test('throws with correct error structure', () => {
    try {
      validate({ email: 'bad' }, { email: ['required', 'email'] })
    } catch (err) {
      expect(err.name).toBe('ValidationException')
      expect(err.errors.email).toBeDefined()
      expect(Array.isArray(err.errors.email)).toBe(true)
    }
  })
})
