/**
 * @eloquentjs/validator — Rule base class
 *
 * Extend this to create reusable, encapsulated validation rules.
 *
 * Sync rule:
 *   class Slug extends Rule {
 *     message() { return `The :field must be a valid slug.` }
 *     passes(field, value) {
 *       return /^[a-z0-9-]+$/.test(value)
 *     }
 *   }
 *
 * Async rule (override passesAsync instead of passes):
 *   class UniqueEmail extends Rule {
 *     message() { return `This email is already taken.` }
 *     async passesAsync(field, value, data) {
 *       const exists = await User.where('email', value).exists()
 *       return !exists
 *     }
 *   }
 *
 * Implicit rule (runs even on null/undefined values):
 *   class RequiredWithout extends Rule {
 *     static implicit = true
 *     ...
 *   }
 *
 * Usage:
 *   const v = Validator.make(data, { email: ['required', new UniqueEmail()] })
 *   await v.validateAsync()
 */

import { DB } from '@eloquentjs/core'

export class Rule {
  /**
   * Whether this rule runs even when the value is null/undefined.
   * False by default — the rule is skipped if the value is empty and not required.
   */
  static implicit = false

  /**
   * Return the error message. Use :field and :value as placeholders.
   * @returns {string}
   */
  message() {
    return 'The :field value is invalid.'
  }

  /**
   * Synchronous check. Return true to pass, false to fail.
   * Override this for sync rules.
   * @param {string} field
   * @param {*} value
   * @param {object} data — full data object (for cross-field rules)
   * @returns {boolean}
   */
  passes(field, value, data) {
    return true
  }

  /**
   * Asynchronous check. Override this for async rules (DB lookups, API calls, etc.)
   * Return true to pass, false to fail.
   * If this method is overridden, it takes precedence over passes().
   * @param {string} field
   * @param {*} value
   * @param {object} data
   * @returns {Promise<boolean>}
   */
  async passesAsync(field, value, data) {
    return this.passes(field, value, data)
  }

  /**
   * Returns true if this rule has an async implementation.
   * @returns {boolean}
   */
  isAsync() {
    return this.passesAsync !== Rule.prototype.passesAsync
  }

  /**
   * Format the error message, substituting :field and :value.
   * @param {string} field
   * @param {*} value
   * @returns {string}
   */
  formatMessage(field, value) {
    return this.message()
      .replace(/:field/g, field)
      .replace(/:value/g, String(value ?? ''))
  }
}

// ─── Built-in Rule subclasses ──────────────────────────────────────────────────

/**
 * Unique rule — checks that no record in the DB has this value.
 *
 * Usage:
 *   email: ['required', 'email', Rule.unique('users', 'email')]
 *   email: ['required', 'email', Rule.unique('users', 'email').ignore(userId)]
 */
export class UniqueRule extends Rule {
  constructor(table, column, connection = null) {
    super()
    this.table      = table
    this.column     = column
    this.connection = connection
    this._ignoreId  = null
    this._ignoreCol = 'id'
    this._where     = []
  }

  /** Ignore a specific ID (for update scenarios) */
  ignore(id, column = 'id') {
    this._ignoreId  = id
    this._ignoreCol = column
    return this
  }

  /** Add extra WHERE conditions */
  where(column, value) {
    this._where.push([column, value])
    return this
  }

  message() { return 'The :field has already been taken.' }

  /**
   * No try/catch: a uniqueness check that swallows its own errors always
   * passes, which is exactly the wrong failure mode for a rule whose job is
   * to reject duplicates. If the database is unreachable, that must surface.
   */
  async passesAsync(field, value, data) {
    if (value == null || value === '') return true

    let qb = DB.table(this.table, this.connection ?? 'default')
      .where(this.column ?? field, value)

    if (this._ignoreId != null) {
      qb = qb.where(this._ignoreCol, '!=', this._ignoreId)
    }
    for (const [col, val] of this._where) {
      qb = qb.where(col, val)
    }

    return Number(await qb.count()) === 0
  }
}

/**
 * Exists rule — checks that a record with this value exists in the DB.
 *
 * Usage:
 *   role_id: ['required', Rule.exists('roles', 'id')]
 */
export class ExistsRule extends Rule {
  constructor(table, column = 'id', connection = null) {
    super()
    this.table      = table
    this.column     = column
    this.connection = connection
    this._where     = []
  }

  where(column, value) {
    this._where.push([column, value])
    return this
  }

  message() { return 'The selected :field is invalid.' }

  async passesAsync(field, value, data) {
    if (value == null || value === '') return true

    let qb = DB.table(this.table, this.connection ?? 'default').where(this.column, value)
    for (const [col, val] of this._where) {
      qb = qb.where(col, val)
    }

    return Number(await qb.count()) > 0
  }
}

// ─── Factory methods on Rule ───────────────────────────────────────────────────
Rule.unique = (table, column, connection = null) => new UniqueRule(table, column, connection)
Rule.exists = (table, column = 'id', connection = null) => new ExistsRule(table, column, connection)
