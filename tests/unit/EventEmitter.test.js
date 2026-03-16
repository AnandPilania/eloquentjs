/**
 * Unit tests — EventEmitter & HookRegistry
 */

import { EventEmitter } from '../../packages/core/src/EventEmitter.js'
import { HookRegistry }  from '../../packages/core/src/HookRegistry.js'

beforeEach(() => {
  EventEmitter.flushAll()
  HookRegistry.flushAll()
})

// ─── EventEmitter ─────────────────────────────────────────────────────────────
describe('EventEmitter', () => {
  test('on() registers a listener', async () => {
    const received = []
    EventEmitter.on('test:event', val => received.push(val))
    await EventEmitter.emit('test:event', 42)
    expect(received).toEqual([42])
  })

  test('emit() passes multiple args', async () => {
    let got
    EventEmitter.on('multi', (a, b, c) => { got = [a, b, c] })
    await EventEmitter.emit('multi', 1, 2, 3)
    expect(got).toEqual([1, 2, 3])
  })

  test('multiple listeners all fire', async () => {
    const results = []
    EventEmitter.on('ev', () => results.push('A'))
    EventEmitter.on('ev', () => results.push('B'))
    EventEmitter.on('ev', () => results.push('C'))
    await EventEmitter.emit('ev')
    expect(results).toEqual(['A', 'B', 'C'])
  })

  test('listeners fire in registration order', async () => {
    const order = []
    EventEmitter.on('order', () => order.push(1))
    EventEmitter.on('order', () => order.push(2))
    EventEmitter.on('order', () => order.push(3))
    await EventEmitter.emit('order')
    expect(order).toEqual([1, 2, 3])
  })

  test('async listeners are awaited', async () => {
    const order = []
    EventEmitter.on('async', async () => {
      await new Promise(r => setTimeout(r, 10))
      order.push('slow')
    })
    EventEmitter.on('async', () => order.push('fast'))
    await EventEmitter.emit('async')
    expect(order).toEqual(['slow', 'fast'])
  })

  test('on() returns an unsubscribe function', async () => {
    const hits = []
    const unsub = EventEmitter.on('unsub', () => hits.push(1))
    await EventEmitter.emit('unsub')
    unsub()
    await EventEmitter.emit('unsub')
    expect(hits).toHaveLength(1)
  })

  test('off() removes a specific listener', async () => {
    const hits = []
    const listener = () => hits.push(1)
    EventEmitter.on('off-test', listener)
    EventEmitter.off('off-test', listener)
    await EventEmitter.emit('off-test')
    expect(hits).toHaveLength(0)
  })

  test('once() fires only once', async () => {
    const hits = []
    EventEmitter.once('once', () => hits.push(1))
    await EventEmitter.emit('once')
    await EventEmitter.emit('once')
    await EventEmitter.emit('once')
    expect(hits).toHaveLength(1)
  })

  test('emit() on unregistered event does nothing', async () => {
    await expect(EventEmitter.emit('nonexistent', 'x')).resolves.toBeUndefined()
  })

  test('flush() removes all listeners for an event', async () => {
    const hits = []
    EventEmitter.on('flush-me', () => hits.push(1))
    EventEmitter.on('flush-me', () => hits.push(2))
    EventEmitter.flush('flush-me')
    await EventEmitter.emit('flush-me')
    expect(hits).toHaveLength(0)
  })

  test('flushAll() removes all listeners', async () => {
    const hits = []
    EventEmitter.on('a', () => hits.push('a'))
    EventEmitter.on('b', () => hits.push('b'))
    EventEmitter.flushAll()
    await EventEmitter.emit('a')
    await EventEmitter.emit('b')
    expect(hits).toHaveLength(0)
  })

  test('observe() registers multiple lifecycle events', async () => {
    const events = []
    class Dummy {}

    EventEmitter.observe(Dummy, {
      creating: () => events.push('creating'),
      created:  () => events.push('created'),
      deleting: () => events.push('deleting'),
    })

    await EventEmitter.emit('Dummy:creating')
    await EventEmitter.emit('Dummy:created')
    await EventEmitter.emit('Dummy:deleting')
    await EventEmitter.emit('Dummy:updated') // no observer for this

    expect(events).toEqual(['creating', 'created', 'deleting'])
  })

  test('listen() is alias for on()', async () => {
    const hits = []
    EventEmitter.listen('alias-test', () => hits.push(1))
    await EventEmitter.emit('alias-test')
    expect(hits).toHaveLength(1)
  })
})

// ─── HookRegistry ─────────────────────────────────────────────────────────────
describe('HookRegistry', () => {
  class Widget {}
  class Gadget {}

  test('register() + fire() executes hook', async () => {
    const calls = []
    HookRegistry.register(Widget, 'creating', m => calls.push(m))
    await HookRegistry.for(Widget).fire('creating', 'the-model')
    expect(calls).toEqual(['the-model'])
  })

  test('multiple hooks for same event fire in order', async () => {
    const order = []
    HookRegistry.register(Widget, 'created', () => order.push(1))
    HookRegistry.register(Widget, 'created', () => order.push(2))
    HookRegistry.register(Widget, 'created', () => order.push(3))
    await HookRegistry.for(Widget).fire('created', null)
    expect(order).toEqual([1, 2, 3])
  })

  test('hooks for different events do not cross-fire', async () => {
    const calls = { creating: 0, created: 0 }
    HookRegistry.register(Widget, 'creating', () => calls.creating++)
    HookRegistry.register(Widget, 'created',  () => calls.created++)
    await HookRegistry.for(Widget).fire('creating', null)
    expect(calls).toEqual({ creating: 1, created: 0 })
  })

  test('hooks for different models do not cross-fire', async () => {
    const calls = { widget: 0, gadget: 0 }
    HookRegistry.register(Widget, 'saving', () => calls.widget++)
    HookRegistry.register(Gadget, 'saving', () => calls.gadget++)
    await HookRegistry.for(Widget).fire('saving', null)
    expect(calls).toEqual({ widget: 1, gadget: 0 })
  })

  test('async hooks are awaited in sequence', async () => {
    const order = []
    HookRegistry.register(Widget, 'updating', async () => {
      await new Promise(r => setTimeout(r, 10))
      order.push('slow')
    })
    HookRegistry.register(Widget, 'updating', async () => {
      order.push('fast')
    })
    await HookRegistry.for(Widget).fire('updating', null)
    expect(order).toEqual(['slow', 'fast'])
  })

  test('hook can mutate the model argument', async () => {
    const model = { name: 'original', slug: null }
    HookRegistry.register(Widget, 'creating', m => {
      m.slug = m.name.toLowerCase().replace(/ /g, '-')
    })
    await HookRegistry.for(Widget).fire('creating', model)
    expect(model.slug).toBe('original')
  })

  test('observe() registers observer object methods', async () => {
    const log = []
    const observer = {
      creating: m => log.push(`creating:${m}`),
      created:  m => log.push(`created:${m}`),
      deleting: m => log.push(`deleting:${m}`),
    }
    HookRegistry.observe(Widget, observer)

    await HookRegistry.for(Widget).fire('creating', 'w1')
    await HookRegistry.for(Widget).fire('created',  'w2')
    await HookRegistry.for(Widget).fire('updating', 'w3')  // not observed
    await HookRegistry.for(Widget).fire('deleting', 'w4')

    expect(log).toEqual(['creating:w1', 'created:w2', 'deleting:w4'])
  })

  test('flush() clears all hooks for a model', async () => {
    const calls = []
    HookRegistry.register(Widget, 'creating', () => calls.push(1))
    HookRegistry.flush(Widget)
    await HookRegistry.for(Widget).fire('creating', null)
    expect(calls).toHaveLength(0)
  })

  test('flushAll() clears everything', async () => {
    const calls = []
    HookRegistry.register(Widget, 'creating', () => calls.push('w'))
    HookRegistry.register(Gadget, 'creating', () => calls.push('g'))
    HookRegistry.flushAll()
    await HookRegistry.for(Widget).fire('creating', null)
    await HookRegistry.for(Gadget).fire('creating', null)
    expect(calls).toHaveLength(0)
  })

  test('static method hook fires when defined on model class', async () => {
    const calls = []

    class MyModel {
      static async creating(m) { calls.push('static:' + m) }
    }

    await HookRegistry.for(MyModel).fire('creating', 'instance')
    expect(calls).toEqual(['static:instance'])
  })

  test('static method + registered hooks both fire', async () => {
    const order = []

    class MyModel2 {
      static async creating() { order.push('static') }
    }

    HookRegistry.register(MyModel2, 'creating', () => order.push('registered'))
    await HookRegistry.for(MyModel2).fire('creating', null)
    expect(order).toEqual(['static', 'registered'])
  })

  test('firing non-existent event does nothing', async () => {
    await expect(HookRegistry.for(Widget).fire('nonexistent', null)).resolves.toBeUndefined()
  })
})
