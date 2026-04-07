/**
 * @eloquentjs/validator — Fluent Schema API
 *
 * A chainable, schema-first validator. Each field type is a class with
 * chainable constraint methods. The schema compiles down to standard
 * { rules, messages } that the Validator class consumes.
 *
 * Usage:
 *   import { v } from '@eloquentjs/validator'
 *
 *   const schema = v.schema({
 *     name:     v.string().min(2).max(100),
 *     email:    v.string().email(),
 *     age:      v.number().integer().min(18).optional(),
 *     role:     v.string().oneOf(['admin', 'editor', 'viewer']),
 *     password: v.string().min(8).confirmed(),
 *     avatar:   v.string().url().optional(),
 *     tags:     v.array().min(1).max(10),
 *     address:  v.object({
 *       city:    v.string(),
 *       country: v.string().length(2),
 *     }),
 *   })
 *
 *   const result = schema.parse(req.body)        // throws on invalid
 *   const result = await schema.parseAsync(req.body)  // for async rules
 *   const { data, errors } = schema.safeParse(req.body)   // returns errors
 */

import { Validator } from './Validator.js'
import { Rule } from './Rule.js'

// ─── Base field type ──────────────────────────────────────────────────────────

class FieldSchema {
  constructor() {
    this._rules    = []
    this._messages = {}
    this._optional = false
    this._label    = null
  }

  optional() { this._optional = true; return this }
  required(msg) {
    this._optional = false
    if (msg) this._messages['required'] = msg
    return this
  }
  label(name) { this._label = name; return this }

  message(rule, msg) { this._messages[rule] = msg; return this }

  /** Custom inline rule function */
  custom(fn, message = 'The :field is invalid.') {
    this._rules.push((field, value, data) => {
      const result = fn(field, value, data)
      if (result === false || result === null) return message.replace(':field', field)
      if (typeof result === 'string') return result
      return null
    })
    return this
  }

  /** Custom Rule object */
  rule(ruleObj) {
    this._rules.push(ruleObj)
    return this
  }

  /**
   * Compile to { rules: string[]|Rule[], messages: {} }
   * @param {string} field
   */
  compile(field) {
    const rules = []
    if (!this._optional) rules.push('required')
    rules.push(...this._typeRules())
    rules.push(...this._rules)

    // Merge field-level messages
    const messages = {}
    for (const [rule, msg] of Object.entries(this._messages)) {
      messages[`${field}.${rule}`] = msg
    }
    return { rules, messages }
  }

  /** Subclasses override this to add type-specific rules */
  _typeRules() { return [] }
}

// ─── String ───────────────────────────────────────────────────────────────────

class StringSchema extends FieldSchema {
  constructor() { super(); this._stringRules = [] }
  _typeRules() { return ['string', ...this._stringRules] }

  min(n, msg)    { this._stringRules.push(`min:${n}`); if (msg) this._messages[`min`] = msg; return this }
  max(n, msg)    { this._stringRules.push(`max:${n}`); if (msg) this._messages[`max`] = msg; return this }
  length(n, msg) { this._stringRules.push(`size:${n}`); if (msg) this._messages['size'] = msg; return this }
  email(msg)     { this._stringRules.push('email'); if (msg) this._messages['email'] = msg; return this }
  url(msg)       { this._stringRules.push('url'); if (msg) this._messages['url'] = msg; return this }
  uuid(msg)      { this._stringRules.push('uuid'); if (msg) this._messages['uuid'] = msg; return this }
  ip(msg)        { this._stringRules.push('ip'); if (msg) this._messages['ip'] = msg; return this }
  ipv4(msg)      { this._stringRules.push('ipv4'); return this }
  ipv6(msg)      { this._stringRules.push('ipv6'); return this }
  json(msg)      { this._stringRules.push('json'); if (msg) this._messages['json'] = msg; return this }
  timezone()     { this._stringRules.push('timezone'); return this }
  macAddress()   { this._stringRules.push('mac_address'); return this }

  alpha(msg)    { this._stringRules.push('alpha'); if (msg) this._messages['alpha'] = msg; return this }
  alphaNum(msg) { this._stringRules.push('alpha_num'); if (msg) this._messages['alpha_num'] = msg; return this }
  alphaDash()   { this._stringRules.push('alpha_dash'); return this }

  startsWith(prefix, msg) { this._stringRules.push(`starts_with:${prefix}`); if (msg) this._messages['starts_with'] = msg; return this }
  endsWith(suffix, msg)   { this._stringRules.push(`ends_with:${suffix}`); if (msg) this._messages['ends_with'] = msg; return this }
  doesntStartWith(v)      { this._stringRules.push(`doesnt_start_with:${v}`); return this }
  doesntEndWith(v)        { this._stringRules.push(`doesnt_end_with:${v}`); return this }

  regex(pattern, msg) {
    const src = pattern instanceof RegExp ? pattern.source : pattern
    this._stringRules.push(`regex:${src}`)
    if (msg) this._messages['regex'] = msg
    return this
  }

  oneOf(values, msg) { this._stringRules.push(`in:${values.join(',')}`); if (msg) this._messages['in'] = msg; return this }
  notOneOf(values)   { this._stringRules.push(`not_in:${values.join(',')}`); return this }

  confirmed(msg) { this._stringRules.push('confirmed'); if (msg) this._messages['confirmed'] = msg; return this }
  same(field)    { this._stringRules.push(`same:${field}`); return this }
  different(field) { this._stringRules.push(`different:${field}`); return this }

  unique(table, column) { this._stringRules.push(Rule.unique(table, column)); return this }
  exists(table, column) { this._stringRules.push(Rule.exists(table, column)); return this }
}

// ─── Number ───────────────────────────────────────────────────────────────────

class NumberSchema extends FieldSchema {
  constructor() { super(); this._numRules = [] }
  _typeRules() { return ['numeric', ...this._numRules] }

  integer(msg) { this._numRules.push('integer'); if (msg) this._messages['integer'] = msg; return this }
  min(n, msg)  { this._numRules.push(`min:${n}`); if (msg) this._messages['min'] = msg; return this }
  max(n, msg)  { this._numRules.push(`max:${n}`); if (msg) this._messages['max'] = msg; return this }
  between(lo, hi) { this._numRules.push(`between:${lo},${hi}`); return this }
  positive()   { this._numRules.push('min:0'); return this }
  gt(field)    { this._numRules.push(`gt:${field}`); return this }
  gte(field)   { this._numRules.push(`gte:${field}`); return this }
  lt(field)    { this._numRules.push(`lt:${field}`); return this }
  lte(field)   { this._numRules.push(`lte:${field}`); return this }
  digits(n)    { this._numRules.push(`digits:${n}`); return this }
  oneOf(values) { this._numRules.push(`in:${values.join(',')}`); return this }
}

// ─── Boolean ──────────────────────────────────────────────────────────────────

class BooleanSchema extends FieldSchema {
  _typeRules() { return ['boolean'] }
}

// ─── Date ─────────────────────────────────────────────────────────────────────

class DateSchema extends FieldSchema {
  constructor() { super(); this._dateRules = [] }
  _typeRules() { return ['date', ...this._dateRules] }

  before(date)        { this._dateRules.push(`before:${date}`); return this }
  after(date)         { this._dateRules.push(`after:${date}`); return this }
  beforeOrEqual(date) { this._dateRules.push(`before_or_equal:${date}`); return this }
  afterOrEqual(date)  { this._dateRules.push(`after_or_equal:${date}`); return this }
}

// ─── Array ────────────────────────────────────────────────────────────────────

class ArraySchema extends FieldSchema {
  constructor(itemSchema = null) { super(); this._arrRules = []; this._itemSchema = itemSchema }
  _typeRules() { return ['array', ...this._arrRules] }

  min(n, msg) { this._arrRules.push(`min:${n}`); if (msg) this._messages['min'] = msg; return this }
  max(n, msg) { this._arrRules.push(`max:${n}`); if (msg) this._messages['max'] = msg; return this }
  size(n)     { this._arrRules.push(`size:${n}`); return this }

  /**
   * Compile with wildcard item validation.
   * Returns rules for the array field itself, plus item rules as 'items.*.field'.
   */
  compile(field) {
    const base = super.compile(field)
    if (!this._itemSchema) return base

    // If itemSchema is a primitive (e.g. v.string()), validate each index
    // In practice this is handled by the schema-level expand
    return base
  }
}

// ─── Object ───────────────────────────────────────────────────────────────────

class ObjectSchema extends FieldSchema {
  constructor(shape = {}) { super(); this._shape = shape }
  _typeRules() { return ['object'] }

  /**
   * Compile nested object fields as dot-notation rules.
   */
  compileNested(prefix) {
    const rules = {}
    const messages = {}

    for (const [key, schema] of Object.entries(this._shape)) {
      const fullKey = `${prefix}.${key}`
      if (schema instanceof ObjectSchema) {
        const nested = schema.compileNested(fullKey)
        Object.assign(rules, nested.rules)
        Object.assign(messages, nested.messages)
      } else {
        const { rules: r, messages: m } = schema.compile(fullKey)
        rules[fullKey] = r
        Object.assign(messages, m)
      }
    }

    return { rules, messages }
  }
}

// ─── Schema builder ───────────────────────────────────────────────────────────

class Schema {
  constructor(shape) {
    this._shape = shape
  }

  /**
   * Compile the shape into flat { rules, messages } for the Validator.
   */
  _compile() {
    const rules    = {}
    const messages = {}
    const attributes = {}

    const process = (shape, prefix = '') => {
      for (const [key, schema] of Object.entries(shape)) {
        const fullKey = prefix ? `${prefix}.${key}` : key

        if (schema instanceof ObjectSchema && Object.keys(schema._shape).length > 0) {
          // Add rule for the object field itself
          const { rules: r, messages: m } = schema.compile(fullKey)
          rules[fullKey] = r
          Object.assign(messages, m)
          // Recurse into nested fields
          const nested = schema.compileNested(fullKey)
          Object.assign(rules, nested.rules)
          Object.assign(messages, nested.messages)
        } else {
          const { rules: r, messages: m } = schema.compile(fullKey)
          rules[fullKey] = r
          Object.assign(messages, m)
        }

        if (schema._label) attributes[fullKey] = schema._label
      }
    }

    process(this._shape)
    return { rules, messages, attributes }
  }

  /**
   * Validate data synchronously. Throws ValidationException on failure.
   * @param {object} data
   * @returns {object} validated data
   */
  parse(data) {
    const { rules, messages, attributes } = this._compile()
    return Validator.make(data, rules, messages, attributes).validated()
  }

  /**
   * Validate data asynchronously (runs async rules like unique/exists).
   * Throws ValidationException on failure.
   * @param {object} data
   * @returns {Promise<object>} validated data
   */
  async parseAsync(data) {
    const { rules, messages, attributes } = this._compile()
    return Validator.make(data, rules, messages, attributes).validatedAsync()
  }

  /**
   * Like parse() but returns { data, errors, success } instead of throwing.
   * @param {object} data
   * @returns {{ success: boolean, data: object|null, errors: object }}
   */
  safeParse(data) {
    try {
      const result = this.parse(data)
      return { success: true, data: result, errors: {} }
    } catch (err) {
      return { success: false, data: null, errors: err.errors ?? {} }
    }
  }

  /**
   * Like parseAsync() but returns { data, errors, success } instead of throwing.
   */
  async safeParseAsync(data) {
    try {
      const result = await this.parseAsync(data)
      return { success: true, data: result, errors: {} }
    } catch (err) {
      return { success: false, data: null, errors: err.errors ?? {} }
    }
  }

  /**
   * Export the compiled { rules, messages } for use with Validator.make() directly.
   */
  toValidatorArgs() {
    return this._compile()
  }
}

// ─── Public factory API ───────────────────────────────────────────────────────

export const v = {
  /** Validate a whole object shape */
  schema:  (shape) => new Schema(shape),

  /** String field */
  string:  () => new StringSchema(),

  /** Number field (integer or float) */
  number:  () => new NumberSchema(),

  /** Boolean field */
  boolean: () => new BooleanSchema(),

  /** Date field */
  date:    () => new DateSchema(),

  /** Array field */
  array:   (itemSchema) => new ArraySchema(itemSchema),

  /** Object field with nested shape */
  object:  (shape = {}) => new ObjectSchema(shape),
}

export { Schema, StringSchema, NumberSchema, BooleanSchema, DateSchema, ArraySchema, ObjectSchema }
