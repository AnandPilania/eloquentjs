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
 * Client usage — see @eloquentjs/realtime/client, which is browser-safe and
 * imports nothing from Node.
 */

import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter, toSnakePlural } from '@eloquentjs/core'
import { createServer } from 'http'
import crypto from 'crypto'

export { RealtimeClient } from './client.js'

/**
 * @typedef {Object} RealtimeServerOptions
 * @property {number} [port]
 * @property {any} [server] - attach to an existing HTTP server
 * @property {string} [appId]
 * @property {string} [appKey] - required at runtime; throws if missing
 * @property {string} [appSecret] - required at runtime; throws if missing
 * @property {string} [authEndpoint]
 * @property {number} [pingInterval]
 * @property {number} [maxChannelsPerSocket] cap on channels one socket may join
 */

/** @param {RealtimeServerOptions} [options] */
export function createRealtimeServer(options = /** @type {RealtimeServerOptions} */ ({})) {
    return new RealtimeServer(options)
}

/** Constant-time string compare — length mismatch short-circuits (length is not secret). */
function timingSafeEqualStr(a, b) {
    const ab = Buffer.from(String(a))
    const bb = Buffer.from(String(b))
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

class RealtimeServer {
    /** @param {RealtimeServerOptions} [options] */
    constructor({
        port = 6001,
        server = null,     // Attach to existing HTTP server
        appId = 'eloquentjs',
        appKey,
        appSecret,
        authEndpoint = '/broadcasting/auth',
        pingInterval = 30000,
        maxChannelsPerSocket = 100,
    } = {}) {
        if (!appKey || !appSecret) {
            throw new Error(
                '[EloquentJS Realtime] appKey and appSecret must be set explicitly. ' +
                'Never use default values in production — generate a secure random secret ' +
                'and pass it in the options object.'
            )
        }
        this.appId = appId
        this.appKey = appKey
        this.appSecret = appSecret
        this.authEndpoint = authEndpoint
        this.pingInterval = pingInterval
        // A socket subscribing to unlimited arbitrary channel names is an
        // unbounded memory sink on the server.
        this.maxChannelsPerSocket = maxChannelsPerSocket

        // channels: Map<channelName, Set<WebSocket>>
        this._channels = new Map()
        // presence data: Map<channelName, Map<socketId, memberInfo>>
        this._presence = new Map()
        // EventEmitter unsubscribe functions registered by broadcastFrom()
        this._unsubscribers = []
        this._ownsHttpServer = !server

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
    /**
     * @param {typeof import('@eloquentjs/core').Model} ModelClass
     * @param {{events?: string[], channel?: string|null, transform?: Function|null, private?: boolean}} [opts]
     *   `private: true` prefixes the channel with `private-`, so the payload
     *   only reaches sockets that presented a valid signature. Model rows are
     *   otherwise published on an unauthenticated public channel.
     */
    broadcastFrom(ModelClass, {
        events = ['created', 'updated', 'deleted'],
        channel = null,
        transform = null,
        private: isPrivate = false,
    } = {}) {
        // Core's pluraliser, so the channel name matches the REST route and the
        // table — `toSnakeCase(name) + 's'` gave `categorys`.
        const base = channel || toSnakePlural(ModelClass.name)
        const channelName = isPrivate && !base.startsWith('private-') ? `private-${base}` : base

        for (const event of events) {
            const off = EventEmitter.on(`${ModelClass.name}:${event}`, async (model) => {
                const payload = transform ? transform(model, event) : model.toJSON()
                this.broadcast(channelName, event, payload)
                // Also broadcast to per-record channel: users.{id}
                const id = model[ModelClass.primaryKey]
                if (id) this.broadcast(`${channelName}.${id}`, event, payload)
            })
            this._unsubscribers.push(off)
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
        const isPrivate = channel.startsWith('private-')
        const isPresence = channel.startsWith('presence-')

        // Private/presence channels REQUIRE a valid signature. A missing `auth`
        // is a rejection, not a skipped check — omitting the field used to
        // subscribe anyone to any private channel.
        if (isPrivate || isPresence) {
            const expected = this._signChannel(ws.socketId, channel)
            if (!auth || !timingSafeEqualStr(auth, expected)) {
                ws.send(JSON.stringify({ event: 'pusher:error', data: { message: 'Forbidden', code: 4009 } }))
                return
            }
        }

        if (!ws.subscribedChannels.has(channel)
            && ws.subscribedChannels.size >= this.maxChannelsPerSocket) {
            return this._error(ws, `Channel limit reached (${this.maxChannelsPerSocket})`, 4100)
        }

        ; (this._channels.get(channel) ?? this._channels.set(channel, new Set()).get(channel)).add(ws)
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

    /**
     * Relay a client-to-client event.
     *
     * Three checks that were missing, each of which let any connected socket
     * inject arbitrary events into any channel:
     *  1. The sender must be subscribed to the channel.
     *  2. Client events are only allowed on private/presence channels — a
     *     public channel has no authenticated senders.
     *  3. The event name must be `client-` prefixed, so a client can never
     *     forge a server event like `created` or a `pusher_internal:` frame.
     */
    _broadcastClientEvent(senderWs, msg) {
        const channel = msg.channel
        const name = msg.name ?? msg.event

        if (!senderWs.subscribedChannels.has(channel)) return this._error(senderWs, 'Not subscribed to channel')
        if (!channel.startsWith('private-') && !channel.startsWith('presence-')) {
            return this._error(senderWs, 'Client events are only allowed on private and presence channels')
        }
        if (typeof name !== 'string' || !name.startsWith('client-')) {
            return this._error(senderWs, 'Client event names must be prefixed with "client-"')
        }

        const frame = JSON.stringify({ channel, event: name, data: msg.data })
        for (const ws of this._channels.get(channel) ?? []) {
            if (ws !== senderWs && ws.readyState === WebSocket.OPEN) ws.send(frame)
        }
    }

    _error(ws, message, code = 4009) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'pusher:error', data: { message, code } }))
        }
    }

    _signChannel(socketId, channel) {
        const stringToSign = `${socketId}:${channel}`
        return `${this.appKey}:${crypto.createHmac('sha256', this.appSecret).update(stringToSign).digest('hex')}`
    }

    _startPing() {
        this._pingTimer = setInterval(() => {
            this._wss.clients.forEach(ws => {
                if (!ws.isAlive) { ws.terminate(); return }
                ws.isAlive = false
                ws.ping()
            })
        }, this.pingInterval)
        // Allow process to exit even if ping timer is running
        if (this._pingTimer.unref) this._pingTimer.unref()
    }

    // ─── Auth handler (attach to Express/Fastify) ─────────────────────────────
    /**
     * @param {(req: any, socketId: string, channel: string) => any} authCallback
     *   Return false (or null/undefined) to deny, or throw. Only a *positive*
     *   result authorises: returning false used to be treated as "allowed",
     *   because only a throw was checked.
     */
    authHandler(authCallback) {
        return async (req, res) => {
            const { socket_id, channel_name } = req.body ?? {}
            if (!socket_id || !channel_name) {
                return res.status(422).json({ error: 'socket_id and channel_name are required' })
            }
            try {
                const result = await authCallback(req, socket_id, channel_name)
                if (result === false || result === null || result === undefined) {
                    return res.status(403).json({ error: 'Forbidden' })
                }
                const auth = this._signChannel(socket_id, channel_name)
                const channelData = result === true ? null : result
                res.json({ auth, ...(channelData ? { channel_data: JSON.stringify(channelData) } : {}) })
            } catch (err) {
                res.status(403).json({ error: 'Forbidden' })
            }
        }
    }

    /** Release everything this server owns: timer, listeners, sockets, HTTP server. */
    async close() {
        clearInterval(this._pingTimer)
        this._pingTimer = null

        // Without this, broadcastFrom() listeners keep firing — and keep the
        // server object alive — after close().
        for (const off of this._unsubscribers) off()
        this._unsubscribers = []

        for (const ws of this._wss.clients) ws.terminate()
        this._channels.clear()
        this._presence.clear()

        await new Promise(resolve => this._wss.close(resolve))
        // Only close the HTTP server we created; an injected one is the caller's.
        if (this._ownsHttpServer) {
            await new Promise(resolve => this._httpServer.close(resolve))
        }
    }
}
