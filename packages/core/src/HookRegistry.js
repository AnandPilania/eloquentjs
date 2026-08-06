/**
 * @eloquentjs/core — HookRegistry
 *
 * The single dispatcher for model lifecycle events. Three layers, fired in
 * order for one event:
 *   1. Static methods on the Model class  (e.g. static creating(model) {...})
 *   2. Programmatically registered hooks  (HookRegistry.register(User, 'creating', fn))
 *   3. Observer objects                   (HookRegistry.observe(User, new UserObserver()))
 *   4. String listeners on EventEmitter   (`User:creating`) — kept for the
 *      event-bus API; Model only ever calls fire().
 *
 * Hooks are awaited sequentially. A "-ing" hook that returns exactly `false`
 * cancels the operation, like Eloquent's cancellable events.
 *
 * Registration is keyed on the class *reference*, not `ModelClass.name`: two
 * `User` classes from different modules no longer collide, and minification
 * cannot break it. Hooks registered on a base class fire for subclasses too.
 */

import { EventEmitter } from './EventEmitter.js'

// A Map, not a WeakMap, so flushAll() can clear it. Model classes are
// module-level singletons — there is nothing here to garbage collect.
/** @type {Map<Function, Map<string, Function[]>>} */
const _hooks = new Map()

export const EVENTS = [
  'retrieved',
  'saving', 'saved',
  'creating', 'created',
  'updating', 'updated',
  'deleting', 'deleted',
  'restoring', 'restored',
  'forceDeleting', 'forceDeleted',
  'pruning',
]

function listenersFor(ModelClass, event) {
  const out = []
  // Walk up the class chain so hooks on a base class apply to subclasses.
  for (let k = ModelClass; typeof k === 'function'; k = Object.getPrototypeOf(k)) {
    const fns = _hooks.get(k)?.get(event)
    if (fns) out.unshift(...fns)
  }
  return out
}

class ModelHooks {
  constructor(ModelClass) {
    this.ModelClass = ModelClass
  }

  /**
   * @param {string} event
   * @param {any} model
   * @returns {Promise<boolean>} false when a hook cancelled the operation
   */
  async fire(event, model) {
    // Layer 1: static method on the model (own or inherited).
    const staticFn = this.ModelClass[event]
    if (typeof staticFn === 'function') {
      if ((await staticFn.call(this.ModelClass, model)) === false) return false
    }

    // Layer 2/3: registered hooks and observers.
    for (const fn of listenersFor(this.ModelClass, event)) {
      if ((await fn(model)) === false) return false
    }

    // Layer 4: the string event bus.
    return EventEmitter.emit(`${this.ModelClass.name}:${event}`, model)
  }
}

export const HookRegistry = {
  /** Get the hooks runner for a Model class. */
  for(ModelClass) {
    return new ModelHooks(ModelClass)
  },

  /**
   * Register a hook function. Returns an unregister function.
   * @param {Function} ModelClass
   * @param {typeof EVENTS[number]} event
   * @param {Function} fn — returning false from a "-ing" event cancels it
   */
  register(ModelClass, event, fn) {
    if (!EVENTS.includes(event)) {
      throw new Error(`[EloquentJS] Unknown model event "${event}". Known: ${EVENTS.join(', ')}`)
    }
    let byEvent = _hooks.get(ModelClass)
    if (!byEvent) _hooks.set(ModelClass, byEvent = new Map())
    if (!byEvent.has(event)) byEvent.set(event, [])
    byEvent.get(event).push(fn)
    return () => {
      const fns = _hooks.get(ModelClass)?.get(event)
      if (fns) byEvent.set(event, fns.filter(f => f !== fn))
    }
  },

  /**
   * Register a full observer object.
   * @param {Function} ModelClass
   * @param {Record<string, Function>} observer — object with lifecycle method names
   */
  observe(ModelClass, observer) {
    for (const event of EVENTS) {
      if (typeof observer[event] === 'function') {
        this.register(ModelClass, event, model => observer[event](model))
      }
    }
    return this
  },

  /** Remove all registered hooks for a Model (not static methods). */
  flush(ModelClass) {
    _hooks.delete(ModelClass)
  },

  flushAll() { _hooks.clear() },
}
