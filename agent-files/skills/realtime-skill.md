# EloquentJS Realtime Skill

## When to use this skill
Use when adding WebSocket-based real-time functionality to an EloquentJS project using `@eloquentjs/realtime`.

---

## Installation

```bash
npm install @eloquentjs/core @eloquentjs/realtime ws
```

---

## Server Setup

```js
import { createRealtimeServer } from '@eloquentjs/realtime'

const rt = createRealtimeServer({
  port:         6001,        // WebSocket port (default: 6001)
  appKey:       'my-app-key',
  appSecret:    'my-secret', // for private channel auth
  pingInterval: 30_000,      // heartbeat interval in ms
})

// Always close cleanly on shutdown — clears ping timer
process.on('SIGTERM', () => rt.close())
process.on('SIGINT',  () => rt.close())
```

---

## Broadcasting Model Events

```js
// Auto-broadcast all lifecycle events for a model
rt.broadcastFrom(User)
// Broadcasts on channels: 'users'
// Events: 'created', 'updated', 'deleted'

// Custom channel name
rt.broadcastFrom(Post, { channel: 'blog-posts' })

// Filter which events to broadcast
rt.broadcastFrom(Order, {
  events: ['created', 'updated'],
})

// Transform the payload before broadcasting
rt.broadcastFrom(User, {
  transform: (user) => ({
    id:    user.id,
    name:  user.name,
    email: user.email,
    // Never expose: password, api_token, etc.
  }),
})

// Per-record channels (e.g. for private updates)
rt.broadcastFrom(Order, {
  channel: (order) => `orders.${order.id}`,  // dynamic channel name
})
```

---

## Manual Broadcasting

```js
// Broadcast to all subscribers of a channel
rt.broadcast('notifications', 'alert', {
  message: 'New deployment completed',
  severity: 'info',
})

// Broadcast to a specific record's channel
rt.broadcast('orders.123', 'updated', order.toJSON())

// Broadcast to a private channel
rt.broadcast('private-chat.room.42', 'message', { text: 'Hello!' })
```

---

## Client Setup (Browser or Node)

```js
import { RealtimeClient } from '@eloquentjs/realtime'

const client = new RealtimeClient('ws://localhost:6001')

// Subscribe to public channels
const sub = client.subscribe('users')
sub.on('created', user => console.log('New user:', user))
sub.on('updated', user => updateUI(user))
sub.on('deleted', ({ id }) => removeFromUI(id))

// Chain event handlers
client.subscribe('notifications')
  .on('alert',   data => showAlert(data.message))
  .on('refresh', () => window.location.reload())

// Per-record channel
client.subscribe('orders.123')
  .on('updated', order => refreshOrderPage(order))

// Clean up
sub.unsubscribe()

// Fully disconnect (stops reconnect, clears all listeners)
client.disconnect()
```

### Auto-Reconnect

The client reconnects automatically with exponential backoff (1s, 2s, 4s, … up to 30s) after a dropped connection. All subscriptions are restored on reconnect. Calling `disconnect()` permanently stops reconnection.

---

## Private Channels

Private channels require server-side auth. The client sends a signature request to your server:

```js
// Server: mount the auth handler on your Express app
import { createRealtimeServer } from '@eloquentjs/realtime'

const rt = createRealtimeServer({ appKey: 'key', appSecret: 'secret', port: 6001 })

// Auth endpoint — validates the user can access the requested channel
app.post('/broadcasting/auth', rt.authHandler(async (req, socketId, channel) => {
  const user = req.user  // from your auth middleware

  if (channel.startsWith('private-orders.')) {
    const orderId = channel.replace('private-orders.', '')
    const order   = await Order.find(orderId)
    if (!order || order.user_id !== user.id) throw new Error('Forbidden')
  }

  return { user_id: user.id, user_info: { name: user.name } }
}))

// Client: subscribe to private channel
client.private('orders.123').on('updated', order => refreshOrder(order))
// The client automatically POSTs to /broadcasting/auth and includes the signed token
```

---

## Presence Channels

Presence channels track who is subscribed (online users):

```js
// Client
client.presence('chat.room.1')
  .on('pusher_internal:member_added',   m => addUserToOnlineList(m.user_info))
  .on('pusher_internal:member_removed', m => removeUserFromList(m.user_info))
  .on('message', msg => addChatMessage(msg))
```

---

## Integration with EloquentJS Events

Model events fire automatically through `HookRegistry`. The realtime server listens to `EventEmitter` and broadcasts when models change:

```js
// This is what rt.broadcastFrom(User) does internally:
import { EventEmitter } from '@eloquentjs/core'

EventEmitter.on('User:created', async (user) => {
  rt.broadcast('users', 'created', user.toJSON())
})
EventEmitter.on('User:updated', async (user) => {
  rt.broadcast('users', 'updated', user.toJSON())
})
EventEmitter.on('User:deleted', async (user) => {
  rt.broadcast('users', 'deleted', { id: user.id })
})
```

---

## Server Options Reference

| Option | Default | Description |
|---|---|---|
| `port` | `6001` | WebSocket port |
| `appKey` | `'app-key'` | Pusher-compatible app key |
| `appSecret` | `'app-secret'` | Secret for signing private channel auth |
| `pingInterval` | `30000` | Heartbeat interval in ms |

---

## Pusher JS Compatibility

The server is Pusher-protocol compatible. You can use the official Pusher JS client or Laravel Echo instead of `RealtimeClient`:

```js
import Pusher from 'pusher-js'

const pusher = new Pusher('app-key', {
  wsHost:          'localhost',
  wsPort:          6001,
  forceTLS:        false,
  enabledTransports: ['ws'],
})

pusher.subscribe('users').bind('created', user => console.log(user))
```

Or with Laravel Echo:

```js
import Echo from 'laravel-echo'
import Pusher from 'pusher-js'
window.Pusher = Pusher

const echo = new Echo({
  broadcaster: 'pusher',
  key:         'app-key',
  wsHost:      window.location.hostname,
  wsPort:      6001,
  forceTLS:    false,
  enabledTransports: ['ws', 'wss'],
})

echo.channel('users').listen('.created', user => console.log(user))
```
