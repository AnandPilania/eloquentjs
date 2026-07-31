/**
 * Unit tests — @eloquentjs/realtime channel authorization
 *
 * Drives _subscribe() directly with a fake socket. The server is attached to an
 * unlistened http.Server so nothing binds a port.
 */

import { createServer } from 'node:http'
import { createRealtimeServer } from '../../packages/realtime/src/index.js'

const KEY = 'test-key'
const SECRET = 'test-secret'

let server

function fakeSocket(id = 'sock-1') {
  return { socketId: id, subscribedChannels: new Set(), sent: [], send(m) { this.sent.push(JSON.parse(m)) } }
}

const events = (ws) => ws.sent.map(m => m.event)

beforeEach(() => {
  server = createRealtimeServer({ server: createServer(), appKey: KEY, appSecret: SECRET })
})

afterEach(() => server.close())

describe('Constructor guards', () => {
  test('appKey and appSecret are mandatory', () => {
    expect(() => createRealtimeServer({ server: createServer() })).toThrow(/appKey and appSecret/)
  })
})

describe('Public channels', () => {
  test('subscribe needs no auth', () => {
    const ws = fakeSocket()
    server._subscribe(ws, { channel: 'users' })
    expect(events(ws)).toContain('pusher_internal:subscription_succeeded')
    expect(ws.subscribedChannels.has('users')).toBe(true)
  })
})

describe('Private channels require a valid signature', () => {
  test('a correct signature is accepted', () => {
    const ws = fakeSocket()
    const auth = server._signChannel(ws.socketId, 'private-orders')
    server._subscribe(ws, { channel: 'private-orders', auth })
    expect(events(ws)).toContain('pusher_internal:subscription_succeeded')
    expect(ws.subscribedChannels.has('private-orders')).toBe(true)
  })

  test('a MISSING auth field is rejected, not skipped', () => {
    // The bypass: omitting `auth` used to skip the check entirely.
    const ws = fakeSocket()
    server._subscribe(ws, { channel: 'private-orders' })
    expect(events(ws)).toEqual(['pusher:error'])
    expect(ws.sent[0].data.code).toBe(4009)
    expect(ws.subscribedChannels.size).toBe(0)
    expect(server._channels.has('private-orders')).toBe(false)
  })

  test('a wrong signature is rejected', () => {
    const ws = fakeSocket()
    server._subscribe(ws, { channel: 'private-orders', auth: `${KEY}:deadbeef` })
    expect(events(ws)).toEqual(['pusher:error'])
    expect(ws.subscribedChannels.size).toBe(0)
  })

  test('a signature for a different channel is rejected', () => {
    const ws = fakeSocket()
    const auth = server._signChannel(ws.socketId, 'private-other')
    server._subscribe(ws, { channel: 'private-orders', auth })
    expect(events(ws)).toEqual(['pusher:error'])
  })

  test('a signature for a different socket is rejected', () => {
    const ws = fakeSocket('sock-1')
    const auth = server._signChannel('sock-2', 'private-orders')
    server._subscribe(ws, { channel: 'private-orders', auth })
    expect(events(ws)).toEqual(['pusher:error'])
  })
})

describe('Presence channels require a valid signature', () => {
  test('missing auth is rejected before any member is registered', () => {
    const ws = fakeSocket()
    server._subscribe(ws, {
      channel: 'presence-room',
      channel_data: JSON.stringify({ user_id: 1, user_info: { name: 'Alice' } }),
    })
    expect(events(ws)).toEqual(['pusher:error'])
    expect(server._presence.has('presence-room')).toBe(false)
  })

  test('a valid signature registers the member', () => {
    const ws = fakeSocket()
    const auth = server._signChannel(ws.socketId, 'presence-room')
    server._subscribe(ws, {
      channel: 'presence-room',
      auth,
      channel_data: JSON.stringify({ user_id: 1, user_info: { name: 'Alice' } }),
    })
    expect(events(ws)).toContain('pusher_internal:subscription_succeeded')
    expect(server._presence.get('presence-room').get(ws.socketId)).toEqual({ user_id: 1, user_info: { name: 'Alice' } })
  })
})
