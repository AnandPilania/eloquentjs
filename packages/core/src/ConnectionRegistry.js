/**
 * @eloquentjs/core — ConnectionRegistry
 *
 * Holds named database connections. Models resolve their connection by name.
 * Default connection name is 'default'.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const _connections = new Map()

// Transaction scope: Map<connectionName, resolver>. A driver's transaction()
// binds a resolver to the transaction's client/session and runs the callback
// inside runInTransaction(), so every getResolver() below it — including the
// ones Model.save() and QueryBuilder do — sees the transactional resolver.
// This is what makes `await User.create()` inside DB.transaction() participate.
const _txScope = new AsyncLocalStorage()

/**
 * Register a resolver (driver instance) under a name.
 * @param {object} resolver  - driver implementing the Resolver interface
 * @param {string} name      - connection name (default: 'default')
 */
export function setResolver(resolver, name = 'default') {
  _connections.set(name, resolver)
}

/**
 * Run `fn` with `resolver` overriding the named connection, for `fn` and
 * everything it awaits. Drivers call this from their transaction().
 * @template T
 * @param {string} name
 * @param {object} resolver
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function runInTransaction(name, resolver, fn) {
  const store = new Map(_txScope.getStore() ?? [])
  store.set(name, resolver)
  return _txScope.run(store, fn)
}

/** The transactional resolver for `name`, if we are inside one. */
export function activeTransactionResolver(name = 'default') {
  return _txScope.getStore()?.get(name)
}

/** True when the named connection is inside a transaction on this async path. */
export function inTransaction(name = 'default') {
  return activeTransactionResolver(name) !== undefined
}

/**
 * Get a registered resolver.
 * @param {string} name
 * @returns {import('./Model.js').ModelResolver}
 */
export function getResolver(name = 'default') {
  const r = activeTransactionResolver(name) ?? _connections.get(name)
  if (!r) {
    throw new Error(
      `[EloquentJS] No connection "${name}" registered. ` +
      `Did you call connect() from a driver package?`
    )
  }
  return r
}

export function hasResolver(name = 'default') {
  return _connections.has(name)
}

export function removeResolver(name = 'default') {
  _connections.delete(name)
}

export function clearResolvers() {
  _connections.clear()
}
