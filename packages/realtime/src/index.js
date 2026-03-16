/**
 * @eloquentjs/realtime
 *
 * Real-time model subscriptions via WebSocket.
 * Integrates with the core EventEmitter to broadcast model lifecycle events.
 * Compatible with Pusher protocol (works with Pusher JS client, Laravel Echo, etc.)
 *
 * Server usage:
 *   import { createRealtimeServer } from '@eloquentjs/realtime'
 *
 *   const rt = createRealtimeServer({ port: 6001 })
 *   rt.broadcastFrom(User)     // auto-broadcast User:created/updated/deleted
 *   rt.broadcastFrom(Post)
 *
 * Client (browser) usage with built-in EloquentJS client:
 *   import { RealtimeClient } from '@eloquentjs/realtime/client'
 *   const client = new RealtimeClient('ws://localhost:6001')
 *
 *   client.subscribe('users', ['created', 'updated'])
 *     .on('created', user => console.log('New user:', user))
 *     .on('updated', user => console.log('User updated:', user))
 *
 *   // Private channels (auth required)
 *   client.private('users.1').on('updated', ...)
 *
 *   // Presence channels (see who's online)
 *   client.presence('chat.room.1').on('join', member => ...)
 */

import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from '@eloquentjs/core'
import { createServer } from 'http'
import crypto from 'crypto'

export function createRealtimeServer(options = {}) {
  return new RealtimeServer(options)
}

class RealtimeServer {
  constructor({
    port = 6001,
    server = null,     // Attach to existing HTTP server
    appId = 'eloquentjs',
    appKey = 'default-key',
    appSecret = 'default-secret',
    authEndpoint = '/broadcasting/auth',
    pingInterval = 30000,
  } = {}) {
    this.appId = appId
    this.appKey = appKey
    this.appSecret = appSecret
    this.authEndpoint = authEndpoint
    this.pingInterval = pingInterval

    // channels: Map<channelName, Set<WebSocket>>
    this._channels = new Map()
    // presence data: Map<channelName, Map<socketId, memberInfo>>
    this._presence = new Map()

    this._httpServer = server || createServer()
    this._wss = new WebSocketServer({ server: this._httpServer })
    this._wss.on('connection', (ws, req) => this._handleConnection(ws, req))

    if (!server) {
      this._httpServer.listen(port, () => {
        console.log(`[EloquentJS Realtime] WebSocket server listening on port ${port}`)
      })
    }

    this._startPing()
  }

  // ─── Auto-broadcast model events ──────────────────────────────────────────
  broadcastFrom(ModelClass, {
    events = ['created', 'updated', 'deleted'],
    channel = null,
    transform = null,
  } = {}) {
    const channelName = channel || toSnake(ModelClass.name) + 's'

    for (const event of events) {
      EventEmitter.on(`${ModelClass.name}:${event}`, async (model) => {
        const payload = transform ? transform(model, event) : model.toJSON()
        this.broadcast(channelName, event, payload)
        // Also broadcast to per-record channel: users.{id}
        const id = model[ModelClass.primaryKey]
        if (id) this.broadcast(`${channelName}.${id}`, event, payload)
      })
    }

    return this
  }

  // ─── Manual broadcast ──────────────────────────────────────────────────────
  broadcast(channel, event, data) {
    const message = JSON.stringify({ channel, event, data })
    const subscribers = this._channels.get(channel) ?? new Set()
    for (const ws of subscribers) {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    }
    return this
  }

  // ─── Connection handling ───────────────────────────────────────────────────
  _handleConnection(ws, req) {
    const socketId = crypto.randomUUID()
    ws.socketId = socketId
    ws.subscribedChannels = new Set()

    // Send connection established event
    ws.send(JSON.stringify({
      event: 'pusher:connection_established',
      data: JSON.stringify({ socket_id: socketId, activity_timeout: 120 }),
    }))

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        this._handleMessage(ws, msg)
      } catch (e) {
        ws.send(JSON.stringify({ event: 'pusher:error', data: { message: 'Invalid JSON' } }))
      }
    })

    ws.on('close', () => this._handleDisconnect(ws))
    ws.on('error', () => this._handleDisconnect(ws))
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
  }

  _handleMessage(ws, msg) {
    switch (msg.event) {
      case 'pusher:subscribe':
        this._subscribe(ws, msg.data)
        break
      case 'pusher:unsubscribe':
        this._unsubscribe(ws, msg.data?.channel)
        break
      case 'pusher:ping':
        ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
        break
      case 'client-event': // client-to-client events
        if (msg.channel) this._broadcastClientEvent(ws, msg)
        break
    }
  }

  _subscribe(ws, { channel, auth, channel_data }) {
    const isPrivate  = channel.startsWith('private-')
    const isPresence = channel.startsWith('presence-')

    // Auth check for private/presence
    if ((isPrivate || isPresence) && auth) {
      const expected = this._signChannel(ws.socketId, channel)
      if (auth !== expected) {
        ws.send(JSON.stringify({ event: 'pusher:error', data: { message: 'Forbidden', code: 4009 } }))
        return
      }
    }

    ;(this._channels.get(channel) ?? this._channels.set(channel, new Set()).get(channel)).add(ws)
    ws.subscribedChannels.add(channel)

    if (isPresence && channel_data) {
      const member = JSON.parse(channel_data)
      if (!this._presence.has(channel)) this._presence.set(channel, new Map())
      this._presence.get(channel).set(ws.socketId, member)

      // Broadcast member_added
      this.broadcast(channel, 'pusher_internal:member_added', { user_id: member.user_id, user_info: member.user_info })
    }

    ws.send(JSON.stringify({
      event: 'pusher_internal:subscription_succeeded',
      channel,
      data: isPresence ? JSON.stringify({ presence: { hash: Object.fromEntries(this._presence.get(channel) ?? []) } }) : '{}',
    }))
  }

  _unsubscribe(ws, channel) {
    if (!channel) return
    this._channels.get(channel)?.delete(ws)
    ws.subscribedChannels.delete(channel)

    if (this._presence.has(channel)) {
      const member = this._presence.get(channel).get(ws.socketId)
      this._presence.get(channel).delete(ws.socketId)
      if (member) this.broadcast(channel, 'pusher_internal:member_removed', { user_id: member.user_id })
    }
  }

  _handleDisconnect(ws) {
    for (const channel of ws.subscribedChannels) {
      this._unsubscribe(ws, channel)
    }
  }

  _broadcastClientEvent(senderWs, msg) {
    const subscribers = this._channels.get(msg.channel) ?? new Set()
    for (const ws of subscribers) {
      if (ws !== senderWs && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg))
      }
    }
  }

  _signChannel(socketId, channel) {
    const stringToSign = `${socketId}:${channel}`
    return `${this.appKey}:${crypto.createHmac('sha256', this.appSecret).update(stringToSign).digest('hex')}`
  }

  _startPing() {
    setInterval(() => {
      this._wss.clients.forEach(ws => {
        if (!ws.isAlive) { ws.terminate(); return }
        ws.isAlive = false
        ws.ping()
      })
    }, this.pingInterval)
  }

  // ─── Auth handler (attach to Express/Fastify) ─────────────────────────────
  authHandler(authCallback) {
    return async (req, res) => {
      const { socket_id, channel_name } = req.body
      try {
        const channelData = await authCallback(req, socket_id, channel_name)
        const auth = this._signChannel(socket_id, channel_name)
        res.json({ auth, ...(channelData ? { channel_data: JSON.stringify(channelData) } : {}) })
      } catch (err) {
        res.status(403).json({ error: 'Forbidden' })
      }
    }
  }

  close() { this._wss.close() }
}

// ─── Lightweight browser/Node client ──────────────────────────────────────
export class RealtimeClient {
  constructor(url, { appKey } = {}) {
    this._url = url
    this._handlers = new Map()   // channel:event -> [fn]
    this._subscriptions = new Map()
    this._reconnectDelay = 1000
    this._connect()
  }

  _connect() {
    this._ws = new WebSocket(this._url)

    this._ws.on('open', () => {
      this._reconnectDelay = 1000
      // Re-subscribe to all channels after reconnect
      for (const [channel] of this._subscriptions) {
        this._sendSubscribe(channel)
      }
    })

    this._ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        const handlers = this._handlers.get(`${msg.channel}:${msg.event}`) ?? []
        for (const fn of handlers) fn(typeof msg.data === 'string' ? JSON.parse(msg.data) : msg.data)
      } catch {}
    })

    this._ws.on('close', () => {
      setTimeout(() => { this._reconnectDelay = Math.min(this._reconnectDelay * 2, 30000); this._connect() }, this._reconnectDelay)
    })
  }

  subscribe(channel) {
    this._subscriptions.set(channel, true)
    this._sendSubscribe(channel)
    const sub = {
      on: (event, fn) => {
        const key = `${channel}:${event}`
        ;(this._handlers.get(key) ?? this._handlers.set(key, []).get(key)).push(fn)
        return sub
      },
      off: (event, fn) => {
        const key = `${channel}:${event}`
        const list = this._handlers.get(key) ?? []
        this._handlers.set(key, list.filter(f => f !== fn))
        return sub
      },
      unsubscribe: () => {
        this._subscriptions.delete(channel)
        this._ws.send(JSON.stringify({ event: 'pusher:unsubscribe', data: { channel } }))
      }
    }
    return sub
  }

  private(channel) { return this.subscribe(`private-${channel}`) }
  presence(channel) { return this.subscribe(`presence-${channel}`) }

  _sendSubscribe(channel) {
    if (this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel } }))
    }
  }

  disconnect() { this._ws.close() }
}

function toSnake(name) {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}
