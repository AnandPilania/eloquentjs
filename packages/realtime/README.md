# @eloquentjs/realtime

> Real-time WebSocket subscriptions for EloquentJS models. Pusher-protocol compatible — works with Laravel Echo, Pusher JS client, and more.

```bash
npm install @eloquentjs/core @eloquentjs/realtime
```

---

## Server

```js
import { createRealtimeServer } from '@eloquentjs/realtime'
import { User, Post, Comment } from './models/index.js'

// appKey/appSecret are required — there is no default, so a forgotten
// production secret can't ship silently. Generate your own random values.
const rt = createRealtimeServer({
  port:      6001,
  appKey:    process.env.REALTIME_APP_KEY,
  appSecret: process.env.REALTIME_APP_SECRET,
})

// Auto-broadcast model lifecycle events
rt.broadcastFrom(User)     // User:created, User:updated, User:deleted → channel "users"
rt.broadcastFrom(Post)

// With custom options
rt.broadcastFrom(Post, {
  events:    ['created'],               // only created events
  channel:   'feed',                    // custom channel name
  transform: (post, event) => ({        // shape the payload
    id:    post.id,
    title: post.title,
    event,
  }),
})

// Manual broadcast
rt.broadcast('notifications', 'new-alert', { message: 'Server deployed!' })

// Attach to existing HTTP server (e.g. Express)
import express from 'express'
import { createServer } from 'http'

const app    = express()
const server = createServer(app)
const rt     = createRealtimeServer({ server })

// Private channel auth endpoint
app.post('/broadcasting/auth', rt.authHandler(async (req, socketId, channel) => {
  const user = req.user  // from your auth middleware
  if (!user) throw new Error('Unauthenticated')
  return { user_id: user.id, user_info: { name: user.name } }
}))
```

---

## Client (Browser / Node)

Import from the `./client` subpath. It is browser-safe: it pulls in nothing from
Node, and uses the platform `WebSocket` in a browser and the `ws` package under
Node.

```js
import { RealtimeClient } from '@eloquentjs/realtime/client'

const client = new RealtimeClient('ws://localhost:6001')

// Public channels
client.subscribe('users')
  .on('created', user => console.log('New user:', user))
  .on('updated', user => console.log('Updated:', user))
  .on('deleted', data => console.log('Deleted ID:', data))

// Or bind several events at once
client.subscribe('users', {
  created: user => console.log('New user:', user),
  updated: user => console.log('Updated:', user),
})

// Per-record channel
client.subscribe('users.42')
  .on('updated', user => renderUserCard(user))

// Private channels need a signature, so the client needs an authEndpoint.
// Without one the server rejects the subscription.
const authed = new RealtimeClient('ws://localhost:6001', {
  authEndpoint: '/broadcasting/auth',
  authHeaders: { Authorization: `Bearer ${token}` },
})
authed.private('orders.123')
  .on('updated', order => updateOrderUI(order))

// Presence channels
client.presence('chat.room.1')
  .on('pusher_internal:member_added',   m => addUserToList(m))
  .on('pusher_internal:member_removed', m => removeUserFromList(m))
  .on('message', msg => addChatMessage(msg))

// Client-to-client events. The server only relays names prefixed `client-`,
// only on private/presence channels, and only from a subscribed sender.
client.private('chat.1').trigger('client-typing', { user: 'alice' })

// Unsubscribe from a channel
const sub = client.subscribe('posts')
sub.unsubscribe()

// Fully disconnect — cancels reconnect timer, clears all handlers
client.disconnect()
```

### Security notes

- `broadcastFrom(User)` publishes `user.toJSON()` on a **public** channel. Pass
  `{ private: true }` (or a `private-`/`presence-` channel name) for anything
  that isn't world-readable, and use `transform` to trim the payload.
- `authHandler(cb)` denies unless `cb` returns something truthy. Returning
  `false`, `null` or `undefined` is a rejection; return `true`, or a
  `channel_data` object for presence channels.
- One socket may join at most `maxChannelsPerSocket` channels (default 100).
- `await server.close()` removes the model-event listeners, terminates the
  sockets and closes the HTTP server it created.

### Automatic Reconnect

The client reconnects automatically with exponential backoff (1s → 2s → 4s → ... → 30s cap) when the connection drops. All channel subscriptions are restored on reconnect. Calling `disconnect()` permanently stops reconnection and clears all internal state (no memory leaks).

---

## Server Cleanup

Always call `close()` when shutting down to clear the ping timer and close all connections:

```js
const rt = createRealtimeServer({
  port: 6001, appKey: process.env.REALTIME_APP_KEY, appSecret: process.env.REALTIME_APP_SECRET,
})

// On graceful shutdown
process.on('SIGTERM', async () => {
  rt.close()          // stops ping interval, closes WebSocket server
  await db.end()
  process.exit(0)
})
```

The ping interval uses `unref()` so it does not prevent Node from exiting if the server is the only remaining work.

---

## Pusher Protocol Compatibility

The server speaks the Pusher wire protocol, meaning you can use:

```js
// Laravel Echo (browser)
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'
window.Pusher = Pusher

const echo = new Echo({
  broadcaster: 'pusher',
  key: 'the same appKey passed to createRealtimeServer()',
  wsHost: 'localhost',
  wsPort: 6001,
  forceTLS: false,
  disableStats: true,
})

echo.channel('users')
  .listen('.created', (e) => console.log(e))
```

---

## Options

### Server Options

| Option | Default | Description |
|---|---|---|
| `port` | `6001` | Port to listen on (ignored if `server` provided) |
| `server` | `null` | Attach to an existing `http.Server` |
| `appId` | `'eloquentjs'` | App identifier |
| `appKey` | *(required)* | Public app key — no default; the constructor throws if omitted |
| `appSecret` | *(required)* | Secret for signing auth tokens — no default; the constructor throws if omitted |
| `authEndpoint` | `'/broadcasting/auth'` | Auth endpoint path |
| `pingInterval` | `30000` | WebSocket ping interval (ms) |

### `broadcastFrom` Options

| Option | Default | Description |
|---|---|---|
| `events` | `['created','updated','deleted']` | Which events to broadcast |
| `channel` | model name pluralized | Channel name |
| `transform` | `null` | Transform payload before sending |

---

## License

MIT
