/**
 * @eloquentjs/core — Validator
 *
 *   const v = Validator.make(data, {
 *     name:  ['required', 'string', 'min:2', 'max:100'],
 *     email: ['required', 'email'],
 *     age:   ['integer', 'min:18'],
 *     role:  ['in:admin,editor,viewer'],
 *   })
 *
 *   if (v.fails()) throw new ValidationException(v.errors)
 */

import { ValidationException } from './errors.js'

export class Validator {
  constructor(data, rules, messages = {}) {
    this.data     = data
    this.rules    = rules
    this.messages = messages
    this.errors   = {}
    this._passed  = null
  }

  static make(data, rules, messages = {}) {
    return new Validator(data, rules, messages)
  }

  validate() {
    this.errors = {}

    for (const [field, ruleList] of Object.entries(this.rules)) {
      const value = this.data[field]

      for (const rule of ruleList) {
        const error = this._check(field, value, rule)
        if (error) {
          if (!this.errors[field]) this.errors[field] = []
          this.errors[field].push(error)
          break // stop at first error per field (like Laravel default)
        }
      }
    }

    this._passed = Object.keys(this.errors).length === 0
    return this._passed
  }

  passes() { return this.validate() }
  fails()  { return !this.passes() }

  validated() {
    if (this._passed === null) this.validate()
    if (!this._passed) throw new ValidationException(this.errors)
    const out = {}
    for (const key of Object.keys(this.rules)) {
      if (Object.prototype.hasOwnProperty.call(this.data, key)) {
        out[key] = this.data[key]
      }
    }
    return out
  }

  _check(field, value, rule) {
    // Custom function rule
    if (typeof rule === 'function') {
      return rule(field, value, this.data) ?? null
    }

    const [name, param] = typeof rule === 'string' ? rule.split(':') : [rule, undefined]

    switch (name) {
      case 'required':
        if (value === undefined || value === null || value === '') {
          return this._msg(field, 'required', `The ${field} field is required.`)
        }
        break

      case 'required_if': {
        const [otherField, otherVal] = (param ?? '').split(',')
        if (String(this.data[otherField]) === otherVal) {
          if (value === undefined || value === null || value === '') {
            return this._msg(field, 'required_if', `The ${field} field is required when ${otherField} is ${otherVal}.`)
          }
        }
        break
      }

      case 'nullable':
        if (value === null || value === undefined) return null // always passes
        break

      case 'string':
        if (value != null && typeof value !== 'string') {
          return this._msg(field, 'string', `The ${field} must be a string.`)
        }
        break

      case 'integer':
      case 'int':
        if (value != null && !Number.isInteger(Number(value))) {
          return this._msg(field, 'integer', `The ${field} must be an integer.`)
        }
        break

      case 'numeric':
        if (value != null && isNaN(Number(value))) {
          return this._msg(field, 'numeric', `The ${field} must be a number.`)
        }
        break

      case 'boolean':
        if (value != null && !['0','1','true','false',true,false,0,1].includes(value)) {
          return this._msg(field, 'boolean', `The ${field} must be true or false.`)
        }
        break

      case 'email':
        if (value != null && value !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          return this._msg(field, 'email', `The ${field} must be a valid email address.`)
        }
        break

      case 'url':
        if (value != null && value !== '') {
          try { new URL(String(value)) } catch {
            return this._msg(field, 'url', `The ${field} must be a valid URL.`)
          }
        }
        break

      case 'min': {
        const min = Number(param)
        if (typeof value === 'string' && value.length < min) {
          return this._msg(field, 'min', `The ${field} must be at least ${min} characters.`)
        }
        if (typeof value === 'number' && value < min) {
          return this._msg(field, 'min', `The ${field} must be at least ${min}.`)
        }
        if (Array.isArray(value) && value.length < min) {
          return this._msg(field, 'min', `The ${field} must have at least ${min} items.`)
        }
        break
      }

      case 'max': {
        const max = Number(param)
        if (typeof value === 'string' && value.length > max) {
          return this._msg(field, 'max', `The ${field} may not be greater than ${max} characters.`)
        }
        if (typeof value === 'number' && value > max) {
          return this._msg(field, 'max', `The ${field} may not be greater than ${max}.`)
        }
        if (Array.isArray(value) && value.length > max) {
          return this._msg(field, 'max', `The ${field} may not have more than ${max} items.`)
        }
        break
      }

      case 'between': {
        const [lo, hi] = (param ?? '').split(',').map(Number)
        if (value != null) {
          const n = Number(value)
          if (!isNaN(n) && (n < lo || n > hi)) {
            return this._msg(field, 'between', `The ${field} must be between ${lo} and ${hi}.`)
          }
        }
        break
      }

      case 'in': {
        const allowed = (param ?? '').split(',')
        if (value != null && !allowed.includes(String(value))) {
          return this._msg(field, 'in', `The selected ${field} is invalid.`)
        }
        break
      }

      case 'not_in': {
        const banned = (param ?? '').split(',')
        if (value != null && banned.includes(String(value))) {
          return this._msg(field, 'not_in', `The selected ${field} is invalid.`)
        }
        break
      }

      case 'array':
        if (value != null && !Array.isArray(value)) {
          return this._msg(field, 'array', `The ${field} must be an array.`)
        }
        break

      case 'object':
        if (value != null && (typeof value !== 'object' || Array.isArray(value))) {
          return this._msg(field, 'object', `The ${field} must be an object.`)
        }
        break

      case 'date':
        if (value != null && isNaN(new Date(value).getTime())) {
          return this._msg(field, 'date', `The ${field} is not a valid date.`)
        }
        break

      case 'regex': {
        const re = new RegExp(param)
        if (value != null && !re.test(String(value))) {
          return this._msg(field, 'regex', `The ${field} format is invalid.`)
        }
        break
      }

      case 'confirmed': {
        const confirmation = this.data[`${field}_confirmation`]
        if (value !== confirmation) {
          return this._msg(field, 'confirmed', `The ${field} confirmation does not match.`)
        }
        break
      }

      case 'same': {
        if (value !== this.data[param]) {
          return this._msg(field, 'same', `The ${field} and ${param} must match.`)
        }
        break
      }

      case 'different': {
        if (value === this.data[param]) {
          return this._msg(field, 'different', `The ${field} and ${param} must be different.`)
        }
        break
      }

      case 'unique':
      case 'exists':
        // These require async DB checks — use validateAsync() or custom async rule
        break

      default:
        // Unknown rule — ignore
        break
    }

    return null
  }

  _msg(field, rule, fallback) {
    return this.messages[`${field}.${rule}`]
      ?? this.messages[rule]
      ?? fallback
  }
}
