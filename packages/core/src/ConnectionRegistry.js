/**
 * @eloquentjs/core — ConnectionRegistry
 *
 * Holds named database connections. Models resolve their connection by name.
 * Default connection name is 'default'.
 */

const _connections = new Map()

/**
 * Register a resolver (driver instance) under a name.
 * @param {object} resolver  - driver implementing the Resolver interface
 * @param {string} name      - connection name (default: 'default')
 */
export function setResolver(resolver, name = 'default') {
  _connections.set(name, resolver)
}

/**
 * Get a registered resolver.
 * @param {string} name
 * @returns {object}
 */
export function getResolver(name = 'default') {
  const r = _connections.get(name)
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
