/**
 * @eloquentjs/core — EventEmitter
 *
 * Async global event bus for model lifecycle events.
 * Events fired automatically: Model:creating, Model:created,
 * Model:updating, Model:updated, Model:deleting, Model:deleted, Model:retrieved
 */

// The canonical event list lives with the dispatcher. Cyclic by design:
// HookRegistry fires through this bus.
import { EVENTS } from './HookRegistry.js'

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
   * @returns {Promise<boolean>} false as soon as a listener returns exactly
   * false — how a "-ing" model event cancels the operation.
   */
  async emit(event, ...args) {
    const listeners = _listeners.get(event) ?? []
    for (const fn of listeners) {
      if ((await fn(...args)) === false) return false
    }
    return true
  },

  /** Alias for on() — mirrors Laravel syntax */
  listen: function (event, listener) { return this.on(event, listener) },

  /**
   * Register an observer against the *string bus* — `${ModelClass.name}:event`.
   * Prefer `Model.observe(observer)` / `HookRegistry.observe()`, which key on
   * the class reference and so survive minification and duplicate class names.
   * Kept because the bus is also usable without a model at all.
   * @param {Function} ModelClass
   * @param {Record<string, Function>} observer
   */
  observe(ModelClass, observer) {
    for (const event of EVENTS) {
      if (typeof observer[event] === 'function') {
        this.on(`${ModelClass.name}:${event}`, model => observer[event](model))
      }
    }
    return this
  },

  flush(event) { _listeners.delete(event) },
  flushAll()   { _listeners.clear() },
}
