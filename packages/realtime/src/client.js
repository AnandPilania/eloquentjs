/**
 * @eloquentjs/realtime/client — WebSocket client
 *
 * Runs in browsers and in Node. This file imports nothing Node-only: the
 * subpath used to resolve to the server module, which imports `ws`, `http` and
 * `crypto` and therefore could not load in a browser at all.
 *
 *   import { RealtimeClient } from '@eloquentjs/realtime/client'
 *
 *   const client = new RealtimeClient('ws://localhost:6001')
 *
 *   client.subscribe('users')
 *     .on('created', user => console.log('New user:', user))
 *     .on('updated', user => console.log('User updated:', user))
 *
 *   // Convenience: bind several events at once
 *   client.subscribe('users', {
 *     created: user => ...,
 *     updated: user => ...,
 *   })
 *
 *   // Private and presence channels need a signature from your auth endpoint
 *   const client = new RealtimeClient(url, { authEndpoint: '/broadcasting/auth' })
 *   client.private('users.1').on('updated', ...)
 */

/** The platform WebSocket: the browser global, or `ws` under Node. */
async function resolveWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket
  const { WebSocket } = await import('ws')
  return WebSocket
}

export class RealtimeClient {
  /**
   * @param {string} url
   * @param {{appKey?: string, authEndpoint?: string, authHeaders?: Record<string,string>, fetch?: Function}} [options]
   */
  constructor(url, { appKey, authEndpoint = null, authHeaders = {}, fetch: fetchImpl } = {}) {
    this._url = url
    this._appKey = appKey
    this._authEndpoint = authEndpoint
    this._authHeaders = authHeaders
    this._fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis)

    this._handlers = new Map()   // "channel:event" -> [fn]
    this._subscriptions = new Map()  // channel -> {channelData}
    this._reconnectDelay = 1000
    this._reconnectTimer = null
    this._destroyed = false
    this._socketId = null
    this._ready = this._connect()
  }

  /** Resolves once the socket is open — `await client.ready` before asserting. */
  get ready() { return this._ready }
  get socketId() { return this._socketId }

  async _connect() {
    if (this._destroyed) return
    const WebSocketImpl = await resolveWebSocket()
    if (this._destroyed) return

    const ws = this._ws = new WebSocketImpl(this._url)

    // addEventListener, not .on(): the browser WebSocket has no .on(), and the
    // `ws` package supports both.
    return new Promise(resolve => {
      ws.addEventListener('open', async () => {
        this._reconnectDelay = 1000
        for (const [channel] of this._subscriptions) await this._sendSubscribe(channel)
        resolve(this)
      })

      ws.addEventListener('message', event => {
        let msg
        try { msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) }
        catch { return }

        if (msg.event === 'pusher:connection_established') {
          const data = typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data
          this._socketId = data?.socket_id ?? null
          return
        }

        const handlers = this._handlers.get(`${msg.channel}:${msg.event}`) ?? []
        const payload = typeof msg.data === 'string' ? safeParse(msg.data) : msg.data
        for (const fn of handlers) fn(payload)
      })

      ws.addEventListener('close', () => {
        if (this._destroyed) return
        this._reconnectTimer = setTimeout(() => {
          this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30_000)
          this._ready = this._connect()
        }, this._reconnectDelay)
      })

      ws.addEventListener('error', () => { /* close fires next; reconnect handled there */ })
    })
  }

  /**
   * @param {string} channel
   * @param {Record<string, Function>|string[]} [events] optional event map or
   *   list — the documented two-argument form, which used to be ignored.
   */
  subscribe(channel, events = null) {
    this._subscriptions.set(channel, {})
    this._sendSubscribe(channel)

    const sub = {
      on: (event, fn) => {
        const key = `${channel}:${event}`
        if (!this._handlers.has(key)) this._handlers.set(key, [])
        this._handlers.get(key).push(fn)
        return sub
      },
      off: (event, fn) => {
        const key = `${channel}:${event}`
        const list = this._handlers.get(key) ?? []
        this._handlers.set(key, fn ? list.filter(f => f !== fn) : [])
        return sub
      },
      /** Send a client event. The server only relays `client-` prefixed names. */
      trigger: (event, data) => {
        const name = event.startsWith('client-') ? event : `client-${event}`
        this._send({ event: 'client-event', channel, data, name })
        return sub
      },
      unsubscribe: () => {
        this._subscriptions.delete(channel)
        for (const key of [...this._handlers.keys()]) {
          if (key.startsWith(`${channel}:`)) this._handlers.delete(key)
        }
        this._send({ event: 'pusher:unsubscribe', data: { channel } })
      },
    }

    if (Array.isArray(events)) {
      // ['created','updated'] — register no-op placeholders so .on() can chain later
      for (const event of events) sub.on(event, () => { })
    } else if (events && typeof events === 'object') {
      for (const [event, fn] of Object.entries(events)) sub.on(event, fn)
    }

    return sub
  }

  /**
   * Private channel. Fetches a signature from `authEndpoint` first — without it
   * the server rejects the subscription, which is why the documented
   * `client.private('users.1')` never worked.
   */
  private(channel) { return this.subscribe(`private-${channel}`) }
  presence(channel, channelData = null) {
    const name = `presence-${channel}`
    this._subscriptions.set(name, { channelData })
    return this.subscribe(name)
  }

  async _sendSubscribe(channel) {
    const needsAuth = channel.startsWith('private-') || channel.startsWith('presence-')
    let auth, channel_data

    if (needsAuth) {
      const signed = await this._authorize(channel)
      if (!signed) {
        console.warn(`[EloquentJS Realtime] No auth signature for "${channel}"; ` +
          `pass authEndpoint to the client or the server will reject it.`)
        return
      }
      auth = signed.auth
      channel_data = signed.channel_data
    }

    this._send({ event: 'pusher:subscribe', data: { channel, auth, channel_data } })
  }

  async _authorize(channel) {
    if (!this._authEndpoint || !this._fetch) return null
    // The socket id comes from pusher:connection_established, so wait for open.
    await this._ready
    try {
      const res = await this._fetch(this._authEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders },
        body: JSON.stringify({ socket_id: this._socketId, channel_name: channel }),
      })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  _send(payload) {
    // 1 === OPEN in both implementations.
    if (this._ws?.readyState === 1) this._ws.send(JSON.stringify(payload))
  }

  disconnect() {
    this._destroyed = true
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = null
    this._ws?.close()
    this._handlers.clear()
    this._subscriptions.clear()
  }
}

function safeParse(value) {
  try { return JSON.parse(value) } catch { return value }
}
