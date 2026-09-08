/**
 * @eloquentjs/core — ConnectionRegistry
 *
 * Holds named database connections. Models resolve their connection by name.
 * Default connection name is 'default'.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { performance } from 'node:perf_hooks'

const _connections = new Map()

// ─── Query listeners — DB.listen() ───────────────────────────────────────────
// A single choke point: every Model/QueryBuilder/relation write reaches its
// resolver through getResolver() below, so instrumenting there (rather than
// each resolver method, per driver) covers all of them at once.
const _listeners = new Set()

/** @param {(event: {sql: any, params: any, ms: number, connection: string}) => void} callback */
export function listen(callback) {
  _listeners.add(callback)
  return () => _listeners.delete(callback)
}

export function forgetListeners() {
  _listeners.clear()
}

// Resolver methods that represent an actual query/write worth logging.
const _QUERY_METHODS = new Set([
  'select', 'insert', 'insertMany', 'update', 'delete',
  'aggregate', 'upsert', 'increment', 'truncate', 'raw',
])

/** Wrap a resolver so query methods report to DB.listen() listeners. */
function instrument(resolver, connectionName) {
  if (!_listeners.size) return resolver
  return new Proxy(resolver, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function' || !_QUERY_METHODS.has(prop)) return value

      return async function (...args) {
        const start = performance.now()
        try {
          return await value.apply(target, args)
        } finally {
          const ms = performance.now() - start
          // Best-effort SQL text: toSQL() is optional, non-executing, and only
          // meaningful for select's (table, ctx) shape — other methods still
          // get timed and reported, just without a rendered sql string.
          let sql, params
          if (prop === 'select' && typeof target.toSQL === 'function') {
            try { ({ sql, params } = await target.toSQL(args[0], args[1]) ?? {}) } catch { /* best-effort */ }
          }
          for (const cb of _listeners) {
            try { cb({ sql, params, ms, connection: connectionName }) } catch { /* a listener must never break a query */ }
          }
        }
      }
    },
  })
}

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
  return instrument(r, name)
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
