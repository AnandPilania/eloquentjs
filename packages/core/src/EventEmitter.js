/**
 * @eloquentjs/core — EventEmitter
 *
 * Async global event bus for model lifecycle events.
 * Events fired automatically: Model:creating, Model:created,
 * Model:updating, Model:updated, Model:deleting, Model:deleted, Model:retrieved
 */

const _listeners = new Map()

export const EventEmitter = {
  /**
   * Subscribe to an event. Returns an unsubscribe function.
   * @param {string}   event
   * @param {Function} listener  - may be async
   * @returns {Function} unsubscribe
   */
  on(event, listener) {
    if (!_listeners.has(event)) _listeners.set(event, [])
    _listeners.get(event).push(listener)
    return () => this.off(event, listener)
  },

  /**
   * Subscribe once — auto-removes after first fire.
   */
  once(event, listener) {
    const wrapper = async (...args) => {
      this.off(event, wrapper)
      return listener(...args)
    }
    return this.on(event, wrapper)
  },

  off(event, listener) {
    const list = _listeners.get(event)
    if (!list) return
    _listeners.set(event, list.filter(l => l !== listener))
  },

  /**
   * Fire all listeners for an event sequentially (await each).
   */
  async emit(event, ...args) {
    const listeners = _listeners.get(event) ?? []
    for (const fn of listeners) {
      await fn(...args)
    }
  },

  /** Alias for on() — mirrors Laravel syntax */
  listen: function (event, listener) { return this.on(event, listener) },

  /**
   * Register a full observer object against a Model class.
   * The observer may define: creating, created, updating, updated,
   * deleting, deleted, retrieved, restoring, restored
   */
  observe(ModelClass, observer) {
    const name = ModelClass.name
    const events = ['creating','created','updating','updated',
                    'deleting','deleted','retrieved','restoring','restored']
    for (const event of events) {
      if (typeof observer[event] === 'function') {
        this.on(`${name}:${event}`, model => observer[event](model))
      }
    }
  },

  flush(event) { _listeners.delete(event) },
  flushAll()   { _listeners.clear() },
}
