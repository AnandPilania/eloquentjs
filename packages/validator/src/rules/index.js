/**
 * @eloquentjs/validator/rules
 *
 * All built-in rules as named exports.
 * Useful when you want to compose rule arrays programmatically
 * or document what rules are available.
 *
 * Usage:
 *   import { required, email, min, max, unique } from '@eloquentjs/validator/rules'
 *
 *   const rules = {
 *     name:  [required(), string(), min(2), max(100)],
 *     email: [required(), email(), unique('users', 'email')],
 *     age:   [integer(), min(18)],
 *   }
 */

import { Rule } from '../Rule.js'

// ─── Factory functions ─────────────────────────────────────────────────────────
// Each returns a rule string (or Rule object for DB rules).
// This gives IDE autocomplete and documents available rules.

export const required          = ()          => 'required'
export const nullable          = ()          => 'nullable'
export const sometimes         = ()          => 'sometimes'
export const prohibited        = ()          => 'prohibited'
export const bail              = ()          => 'bail'

export const string            = ()          => 'string'
export const integer           = ()          => 'integer'
export const numeric           = ()          => 'numeric'
export const boolean           = ()          => 'boolean'
export const array             = ()          => 'array'
export const object            = ()          => 'object'
export const date              = ()          => 'date'

export const email             = ()          => 'email'
export const url               = ()          => 'url'
export const uuid              = ()          => 'uuid'
export const ip                = ()          => 'ip'
export const ipv4              = ()          => 'ipv4'
export const ipv6              = ()          => 'ipv6'
export const json              = ()          => 'json'
export const timezone          = ()          => 'timezone'
export const macAddress        = ()          => 'mac_address'

export const alpha             = ()          => 'alpha'
export const alphaNum          = ()          => 'alpha_num'
export const alphaDash         = ()          => 'alpha_dash'

export const min               = (n)         => `min:${n}`
export const max               = (n)         => `max:${n}`
export const size              = (n)         => `size:${n}`
export const length            = (n)         => `size:${n}`
export const between           = (lo, hi)    => `between:${lo},${hi}`
export const digits            = (n)         => `digits:${n}`
export const digitsBetween     = (lo, hi)    => `digits_between:${lo},${hi}`

export const inList            = (...vals)   => `in:${vals.flat().join(',')}`
export const notInList         = (...vals)   => `not_in:${vals.flat().join(',')}`

export const confirmed         = ()          => 'confirmed'
export const same              = (field)     => `same:${field}`
export const different         = (field)     => `different:${field}`

export const regex             = (pattern)   => `regex:${pattern instanceof RegExp ? pattern.source : pattern}`
export const startsWith        = (...v)      => `starts_with:${v.join(',')}`
export const endsWith          = (...v)      => `ends_with:${v.join(',')}`
export const doesntStartWith   = (...v)      => `doesnt_start_with:${v.join(',')}`
export const doesntEndWith     = (...v)      => `doesnt_end_with:${v.join(',')}`

export const before            = (date)      => `before:${date}`
export const after             = (date)      => `after:${date}`
export const beforeOrEqual     = (date)      => `before_or_equal:${date}`
export const afterOrEqual      = (date)      => `after_or_equal:${date}`

export const gt                = (field)     => `gt:${field}`
export const gte               = (field)     => `gte:${field}`
export const lt                = (field)     => `lt:${field}`
export const lte               = (field)     => `lte:${field}`

export const requiredIf        = (f, v)      => `required_if:${f},${v}`
export const requiredWith      = (...fields) => `required_with:${fields.join(',')}`
export const requiredWithAll   = (...fields) => `required_with_all:${fields.join(',')}`
export const requiredWithout   = (...fields) => `required_without:${fields.join(',')}`
export const requiredWithoutAll= (...fields) => `required_without_all:${fields.join(',')}`

// DB-backed async rules — return Rule objects
export const unique = (table, column, connection = null) => Rule.unique(table, column, connection)
export const exists = (table, column = 'id', connection = null) => Rule.exists(table, column, connection)

// ─── Rule collections (convenience groups) ────────────────────────────────────

export const passwordRules = (minLen = 8) => [
  required(), string(), min(minLen),
]

export const emailRules = () => [
  required(), string(), email(), max(255),
]

export const slugRules = () => [
  required(), string(), regex(/^[a-z0-9-]+$/), max(255),
]
