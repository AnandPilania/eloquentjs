/**
 * @eloquentjs/core — DB facade
 *
 * Driver-agnostic entry point for the things that aren't a Model:
 *
 *   await DB.transaction(async () => {
 *     const user = await User.create({ name: 'Alice' })   // joins the transaction
 *     await user.profile().create({ bio: 'Hello' })       // …so does this
 *   })                                                    // throw → ROLLBACK
 *
 *   await DB.table('users').where('email', e).count()
 *   await DB.raw('SELECT 1')
 *
 * Transaction participation works through an AsyncLocalStorage scope in
 * ConnectionRegistry — nothing needs to be threaded through call sites.
 */

import { getResolver, inTransaction } from './ConnectionRegistry.js'
import { Model } from './Model.js'

/** Anonymous Model subclasses for DB.table(), one per table+connection. */
const _tableShims = new Map()

export const DB = {
  /**
   * Run `fn` inside a transaction on the named connection. Every model write
   * inside — including in awaited callees — uses the transaction's connection.
   * Nested calls become savepoints where the driver supports them.
   *
   * @template T
   * @param {(tx: import('./Model.js').ModelResolver) => Promise<T>} fn
   * @param {string} connection
   * @returns {Promise<T>}
   */
  async transaction(fn, connection = 'default') {
    const resolver = getResolver(connection)
    if (typeof resolver.transaction !== 'function') {
      throw new Error(
        `[EloquentJS] Connection "${connection}" (${resolver.constructor.name}) does not support transactions.`
      )
    }
    return resolver.transaction(fn)
  },

  /** True when the named connection is inside a transaction right now. */
  inTransaction(connection = 'default') {
    return inTransaction(connection)
  },

  /**
   * A QueryBuilder over a bare table — no model class required.
   * Rows come back as instances of an internal Model shim, so `.count()`,
   * `.value()`, `.pluck()` and `.exists()` behave exactly as on a real model.
   * @param {string} name
   * @param {string} connection
   */
  table(name, connection = 'default') {
    const key = `${connection}::${name}`
    let Shim = _tableShims.get(key)
    if (!Shim) {
      Shim = class extends Model {
        static table = name
        static connection = connection
        static timestamps = false
        static guarded = []
      }
      Object.defineProperty(Shim, 'name', { value: `Table(${name})` })
      _tableShims.set(key, Shim)
    }
    return Shim.query()
  },

  /**
   * Execute driver-native SQL / commands. Requires the driver to implement raw().
   * @param {string} sql
   * @param {any[]} params
   * @param {string} connection
   */
  async raw(sql, params = [], connection = 'default') {
    const resolver = getResolver(connection)
    if (typeof resolver.raw !== 'function') {
      throw new Error(`[EloquentJS] ${resolver.constructor.name} does not implement raw()`)
    }
    return resolver.raw(sql, params)
  },

  /** The resolver backing the named connection (transaction-aware). */
  connection(name = 'default') {
    return getResolver(name)
  },
}
