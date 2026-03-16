/**
 * @eloquentjs/core — HookRegistry
 *
 * Per-model lifecycle hooks. Two layers:
 *   1. Static methods on the Model class  (e.g. static creating(model) {...})
 *   2. Programmatically registered hooks  (HookRegistry.register(User, 'creating', fn))
 *   3. Observer objects                   (HookRegistry.observe(User, new UserObserver()))
 *
 * All hooks are awaited sequentially before the DB operation completes.
 */

// Map<"ClassName:event", Function[]>
const _hooks = new Map()

class ModelHooks {
  constructor(ModelClass) {
    this.ModelClass = ModelClass
  }

  async fire(event, model) {
    // Layer 1: static method on model (e.g. static async creating(user) { ... })
    const staticFn = this.ModelClass[event]
    if (typeof staticFn === 'function') {
      await staticFn.call(this.ModelClass, model)
    }

    // Layer 2: registered hook functions
    const key = `${this.ModelClass.name}:${event}`
    const fns = _hooks.get(key) ?? []
    for (const fn of fns) {
      await fn(model)
    }
  }
}

export const HookRegistry = {
  /** Get the hooks runner for a Model class. */
  for(ModelClass) {
    return new ModelHooks(ModelClass)
  },

  /**
   * Register a hook function.
   * @param {Function} ModelClass
   * @param {string}   event      - 'creating' | 'created' | 'updating' | 'updated' | 'deleting' | 'deleted' | 'restoring' | 'restored'
   * @param {Function} fn
   */
  register(ModelClass, event, fn) {
    const key = `${ModelClass.name}:${event}`
    if (!_hooks.has(key)) _hooks.set(key, [])
    _hooks.get(key).push(fn)
  },

  /**
   * Register a full observer object.
   * @param {Function} ModelClass
   * @param {object}   observer   - object with lifecycle method names
   */
  observe(ModelClass, observer) {
    const events = ['creating','created','updating','updated',
                    'deleting','deleted','restoring','restored','retrieved']
    for (const event of events) {
      if (typeof observer[event] === 'function') {
        this.register(ModelClass, event, model => observer[event](model))
      }
    }
  },

  /** Remove all registered hooks for a Model (not static methods). */
  flush(ModelClass) {
    const events = ['creating','created','updating','updated',
                    'deleting','deleted','restoring','restored','retrieved']
    for (const event of events) {
      _hooks.delete(`${ModelClass.name}:${event}`)
    }
  },

  flushAll() { _hooks.clear() },
}
