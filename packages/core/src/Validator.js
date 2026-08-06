/**
 * @eloquentjs/core — Validator
 *
 * Rules may be an array or Laravel's pipe string:
 *
 *   const v = Validator.make(data, {
 *     name:  ['required', 'string', 'min:2', 'max:100'],
 *     email: 'required|email|unique:users,email',
 *     age:   ['nullable', 'integer', 'min:18'],
 *     role:  ['in:admin,editor,viewer'],
 *   })
 *
 *   if (v.fails()) throw new ValidationException(v.errors)
 *
 * `unique` and `exists` hit the database, so they only run under
 * validateAsync() / validatedAsync(); the sync path reports them as unchecked
 * rather than pretending they passed.
 *
 * @eloquentjs/validator subclasses this with dot-notation paths, Rule objects
 * and ~40 more rules. Every rule name has exactly one implementation, here or
 * there — never two.
 */

import { ValidationException } from './errors.js'
import { DB } from './DB.js'

/** Rules that run even when the value is empty. */
const IMPLICIT_RULES = [
  'required', 'required_if', 'required_unless', 'required_with',
  'required_with_all', 'required_without', 'required_without_all',
  'prohibited', 'prohibited_if', 'present', 'sometimes', 'nullable', 'filled',
]

/** Rules that need a database round trip. */
const ASYNC_RULES = ['unique', 'exists']

export class Validator {
  constructor(data, rules, messages = {}, attributes = {}) {
    this.data = data
    this.rules = Validator.normalizeRules(rules)
    this.messages = messages
    this.errors = {}
    this._attributes = attributes
    this._passed = null
  }

  static make(data, rules, messages = {}, attributes = {}) {
    return new this(data, rules, messages, attributes)
  }

  /**
   * Accept `'required|email'`, `['required', 'email']` and mixtures.
   * The pipe form is Laravel's canonical syntax; iterating the characters of
   * the string (the old behaviour) silently validated nothing.
   */
  static normalizeRules(rules) {
    const out = {}
    for (const [field, ruleList] of Object.entries(rules ?? {})) {
      out[field] = Validator.normalizeRuleList(ruleList)
    }
    return out
  }

  static normalizeRuleList(ruleList) {
    if (typeof ruleList === 'string') return ruleList.split('|').filter(Boolean)
    if (!Array.isArray(ruleList)) return [ruleList]
    return ruleList.flatMap(r => (typeof r === 'string' && r.includes('|') ? r.split('|').filter(Boolean) : [r]))
  }

  /** Split `'regex:^a:b$'` into ['regex', '^a:b$'] — only on the FIRST colon. */
  static parseRule(rule) {
    if (typeof rule !== 'string') return [rule, undefined]
    const at = rule.indexOf(':')
    return at === -1 ? [rule, undefined] : [rule.slice(0, at), rule.slice(at + 1)]
  }

  validate() {
    this.errors = {}

    for (const [field, ruleList] of Object.entries(this.rules)) {
      const errors = this._validateField(field, ruleList)
      if (errors.length) this.errors[field] = errors
    }

    this._passed = Object.keys(this.errors).length === 0
    return this._passed
  }

  /** Run validation including the rules that need the database. */
  async validateAsync() {
    this.errors = {}

    for (const [field, ruleList] of Object.entries(this.rules)) {
      const errors = await this._validateFieldAsync(field, ruleList)
      if (errors.length) this.errors[field] = errors
    }

    this._passed = Object.keys(this.errors).length === 0
    return this._passed
  }

  passes() { return this.validate() }
  fails() { return !this.passes() }
  async passesAsync() { return this.validateAsync() }
  async failsAsync() { return !(await this.validateAsync()) }

  validated() {
    if (this._passed === null) this.validate()
    if (!this._passed) throw new ValidationException(this.errors)
    return this._extractValidated()
  }

  async validatedAsync() {
    await this.validateAsync()
    if (!this._passed) throw new ValidationException(this.errors)
    return this._extractValidated()
  }

  _extractValidated() {
    const out = {}
    for (const key of Object.keys(this.rules)) {
      const value = this._getValue(key)
      if (value !== undefined) out[key] = value
    }
    return out
  }

  // ─── Field-level ───────────────────────────────────────────────────────────

  _validateField(field, ruleList) {
    const value = this._getValue(field)
    const errors = []

    // `nullable` used to `return null` mid-switch and let the loop carry on,
    // which made it a no-op. It has to short-circuit the whole field.
    if (this._isEmpty(value) && this._hasRule(ruleList, 'nullable') && !this._hasRule(ruleList, 'required')) {
      return errors
    }
    if (this._hasRule(ruleList, 'sometimes') && !this._hasValue(field)) return errors

    for (const rule of ruleList) {
      const [name] = Validator.parseRule(rule)
      if (ASYNC_RULES.includes(name)) continue    // handled by validateAsync()
      if (this._skipOnEmpty(value, rule)) continue

      const error = this._check(field, value, rule)
      if (error) { errors.push(error); break }     // first error per field, like Laravel
    }
    return errors
  }

  async _validateFieldAsync(field, ruleList) {
    const errors = this._validateField(field, ruleList)
    if (errors.length) return errors

    const value = this._getValue(field)
    if (this._isEmpty(value)) return errors

    for (const rule of ruleList) {
      const [name, param] = Validator.parseRule(rule)
      if (!ASYNC_RULES.includes(name)) continue
      const error = await this._checkAsync(field, value, name, param)
      if (error) { errors.push(error); break }
    }
    return errors
  }

  _hasRule(ruleList, name) {
    return ruleList.some(r => Validator.parseRule(r)[0] === name)
  }

  _skipOnEmpty(value, rule) {
    const [name] = Validator.parseRule(rule)
    return this._isEmpty(value) && !IMPLICIT_RULES.includes(name) && typeof rule === 'string'
  }

  _isEmpty(value) {
    return value === undefined || value === null || value === ''
  }

  _getValue(field) { return this.data?.[field] }

  _hasValue(field) {
    return Object.prototype.hasOwnProperty.call(this.data ?? {}, field) && !this._isEmpty(this._getValue(field))
  }

  _displayName(field) {
    return this._attributes?.[field] ?? field.replace(/_/g, ' ')
  }

  // ─── Rule dispatch ─────────────────────────────────────────────────────────

  /**
   * Should `min`/`max`/`size` compare a number or a length? Laravel's rule:
   * numeric when the field is declared numeric/integer, or when the value is
   * already a number. `{age: '20'}` with `min:18` previously compared the
   * *string length* and failed — form and query-string input is always strings.
   */
  _isNumericField(field, value) {
    if (typeof value === 'number') return true
    const ruleList = this.rules[field] ?? []
    const numericish = ruleList.some(r => ['numeric', 'integer', 'int', 'decimal'].includes(Validator.parseRule(r)[0]))
    return numericish && value !== '' && !isNaN(Number(value))
  }

  _check(field, value, rule) {
    // Custom function rule
    if (typeof rule === 'function') {
      return rule(field, value, this.data) ?? null
    }

    const [name, param] = Validator.parseRule(rule)
    const displayField = this._displayName(field)

    switch (name) {
      case 'sometimes':
      case 'nullable':
      case 'bail':
        return null   // handled at field level

      case 'required':
        if (this._isEmpty(value) || (Array.isArray(value) && !value.length)) {
          return this._msg(field, 'required', `The ${displayField} field is required.`)
        }
        break

      case 'filled':
        if (Object.prototype.hasOwnProperty.call(this.data ?? {}, field) && this._isEmpty(value)) {
          return this._msg(field, 'filled', `The ${displayField} field must have a value.`)
        }
        break

      case 'present':
        if (!Object.prototype.hasOwnProperty.call(this.data ?? {}, field)) {
          return this._msg(field, 'present', `The ${displayField} field must be present.`)
        }
        break

      case 'required_if': {
        const [otherField, ...otherVals] = (param ?? '').split(',')
        if (otherVals.map(String).includes(String(this._getValue(otherField)))) {
          if (this._isEmpty(value)) {
            return this._msg(field, 'required_if',
              `The ${displayField} field is required when ${otherField} is ${otherVals.join(' or ')}.`)
          }
        }
        break
      }

      case 'required_unless': {
        const [otherField, ...otherVals] = (param ?? '').split(',')
        if (!otherVals.map(String).includes(String(this._getValue(otherField))) && this._isEmpty(value)) {
          return this._msg(field, 'required_unless',
            `The ${displayField} field is required unless ${otherField} is ${otherVals.join(' or ')}.`)
        }
        break
      }

      case 'string':
        if (typeof value !== 'string') {
          return this._msg(field, 'string', `The ${displayField} must be a string.`)
        }
        break

      case 'integer':
      case 'int':
        if (!Number.isInteger(Number(value)) || String(value).trim() === '') {
          return this._msg(field, 'integer', `The ${displayField} must be an integer.`)
        }
        break

      case 'numeric':
        if (isNaN(Number(value)) || String(value).trim() === '') {
          return this._msg(field, 'numeric', `The ${displayField} must be a number.`)
        }
        break

      case 'boolean':
        if (!['0', '1', 'true', 'false', true, false, 0, 1].includes(value)) {
          return this._msg(field, 'boolean', `The ${displayField} must be true or false.`)
        }
        break

      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          return this._msg(field, 'email', `The ${displayField} must be a valid email address.`)
        }
        break

      case 'url':
        try { new URL(String(value)) } catch {
          return this._msg(field, 'url', `The ${displayField} must be a valid URL.`)
        }
        break

      case 'min': {
        const min = Number(param)
        if (this._isNumericField(field, value)) {
          if (Number(value) < min) {
            return this._msg(field, 'min', `The ${displayField} must be at least ${min}.`)
          }
        } else if (Array.isArray(value)) {
          if (value.length < min) {
            return this._msg(field, 'min', `The ${displayField} must have at least ${min} items.`)
          }
        } else if (String(value).length < min) {
          return this._msg(field, 'min', `The ${displayField} must be at least ${min} characters.`)
        }
        break
      }

      case 'max': {
        const max = Number(param)
        if (this._isNumericField(field, value)) {
          if (Number(value) > max) {
            return this._msg(field, 'max', `The ${displayField} may not be greater than ${max}.`)
          }
        } else if (Array.isArray(value)) {
          if (value.length > max) {
            return this._msg(field, 'max', `The ${displayField} may not have more than ${max} items.`)
          }
        } else if (String(value).length > max) {
          return this._msg(field, 'max', `The ${displayField} may not be greater than ${max} characters.`)
        }
        break
      }

      case 'between': {
        const [lo, hi] = (param ?? '').split(',').map(Number)
        const size = this._isNumericField(field, value)
          ? Number(value)
          : (Array.isArray(value) ? value.length : String(value).length)
        if (size < lo || size > hi) {
          return this._msg(field, 'between', `The ${displayField} must be between ${lo} and ${hi}.`)
        }
        break
      }

      case 'in': {
        const allowed = (param ?? '').split(',')
        if (!allowed.includes(String(value))) {
          return this._msg(field, 'in', `The selected ${displayField} is invalid.`)
        }
        break
      }

      case 'not_in': {
        const banned = (param ?? '').split(',')
        if (banned.includes(String(value))) {
          return this._msg(field, 'not_in', `The selected ${displayField} is invalid.`)
        }
        break
      }

      case 'array':
        if (!Array.isArray(value)) {
          return this._msg(field, 'array', `The ${displayField} must be an array.`)
        }
        break

      case 'object':
        if (typeof value !== 'object' || Array.isArray(value) || value === null) {
          return this._msg(field, 'object', `The ${displayField} must be an object.`)
        }
        break

      case 'date':
        if (isNaN(new Date(value).getTime())) {
          return this._msg(field, 'date', `The ${displayField} is not a valid date.`)
        }
        break

      case 'date_format': {
        // param may itself contain colons ('H:i:s'), which the old
        // rule.split(':') destroyed.
        if (!matchesDateFormat(String(value), String(param ?? ''))) {
          return this._msg(field, 'date_format', `The ${displayField} does not match the format ${param}.`)
        }
        break
      }

      case 'regex': {
        // param keeps every colon after the first, so 'regex:^a:b$' works.
        if (!new RegExp(param).test(String(value))) {
          return this._msg(field, 'regex', `The ${displayField} format is invalid.`)
        }
        break
      }

      case 'not_regex':
        if (new RegExp(param).test(String(value))) {
          return this._msg(field, 'not_regex', `The ${displayField} format is invalid.`)
        }
        break

      case 'confirmed': {
        if (value !== this._getValue(`${field}_confirmation`)) {
          return this._msg(field, 'confirmed', `The ${displayField} confirmation does not match.`)
        }
        break
      }

      case 'same': {
        if (value !== this._getValue(param)) {
          return this._msg(field, 'same', `The ${displayField} and ${param} must match.`)
        }
        break
      }

      case 'different': {
        if (value === this._getValue(param)) {
          return this._msg(field, 'different', `The ${displayField} and ${param} must be different.`)
        }
        break
      }

      case 'accepted':
        if (!['yes', 'on', '1', 1, true, 'true'].includes(value)) {
          return this._msg(field, 'accepted', `The ${displayField} must be accepted.`)
        }
        break

      case 'distinct':
        if (Array.isArray(value) && new Set(value.map(String)).size !== value.length) {
          return this._msg(field, 'distinct', `The ${displayField} field has a duplicate value.`)
        }
        break

      default:
        // Silently ignoring unknown names meant a typo'd 'requird' always
        // passed. Subclasses that add rules override _check and call super
        // only for names they don't handle.
        throw new Error(
          `[EloquentJS] Unknown validation rule "${name}" on field "${field}". ` +
          `Pass a function or a Rule object for custom checks.`
        )
    }

    return null
  }

  /** unique / exists — the rules that need the database. */
  async _checkAsync(field, value, name, param) {
    const displayField = this._displayName(field)

    if (name === 'unique') {
      // unique:table,column,ignoreId,ignoreColumn
      const [table, column = field, ignoreId, ignoreColumn = 'id'] = (param ?? '').split(',').map(s => s?.trim())
      let qb = DB.table(table).where(column, value)
      if (ignoreId !== undefined && ignoreId !== '') qb = qb.where(ignoreColumn, '!=', ignoreId)
      if (Number(await qb.count()) > 0) {
        return this._msg(field, 'unique', `The ${displayField} has already been taken.`)
      }
    }

    if (name === 'exists') {
      const [table, column = 'id'] = (param ?? '').split(',').map(s => s?.trim())
      if (Number(await DB.table(table).where(column, value).count()) === 0) {
        return this._msg(field, 'exists', `The selected ${displayField} is invalid.`)
      }
    }

    return null
  }

  _msg(field, rule, fallback) {
    const msg = this.messages[`${field}.${rule}`] ?? this.messages[rule] ?? fallback
    return String(msg)
      .replace(/:field/g, this._displayName(field))
      .replace(/:attribute/g, this._displayName(field))
      .replace(/:value/g, String(this._getValue(field) ?? ''))
  }
}

/**
 * Minimal PHP-style date-format check — enough for the formats people actually
 * pass (Y-m-d, d/m/Y, H:i, H:i:s, Y-m-d H:i:s).
 */
function matchesDateFormat(value, format) {
  const tokens = {
    Y: '\\d{4}', y: '\\d{2}', m: '\\d{2}', n: '\\d{1,2}',
    d: '\\d{2}', j: '\\d{1,2}', H: '\\d{2}', G: '\\d{1,2}',
    i: '\\d{2}', s: '\\d{2}', A: '(AM|PM)', a: '(am|pm)',
  }
  let pattern = ''
  for (const ch of format) {
    pattern += tokens[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${pattern}$`).test(value)
}
