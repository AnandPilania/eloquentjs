# @eloquentjs/mongodb

> MongoDB driver for EloquentJS. Use the same Eloquent API against MongoDB collections.

```bash
npm install @eloquentjs/core @eloquentjs/mongodb
```

---

## Setup

```js
import { connect } from '@eloquentjs/mongodb'
import { Model } from '@eloquentjs/core'

await connect({
  url:      process.env.MONGO_URL      ?? 'mongodb://localhost:27017',
  database: process.env.MONGO_DATABASE ?? 'myapp',
  // Optional auth
  username: process.env.MONGO_USERNAME,
  password: process.env.MONGO_PASSWORD,
})

class User extends Model {
  static table = 'users'   // maps to MongoDB collection name
}

await User.create({ name: 'Alice' })
await User.where('active', true).get()
await User.find('64a7f...')   // ObjectId string
```

---

## MongoDB-Specific Features

### `id` is an alias of `_id`, in both directions

Documents store only `_id`. `id` is an alias, applied on reads *and* on every
filter, sort, projection and update path — so the default
`Model.primaryKey = 'id'` works and you do **not** need `static primaryKey = '_id'`.

```js
// ObjectId handling — 'id' and '_id' are interchangeable
const user = await User.find('64a7f3b2c1a2b3c4d5e6f7a8')   // filters on _id
console.log(user.id)   // '64a7f3b2c1a2b3c4d5e6f7a8'
console.log(user._id)  // same string

user.name = 'Alice'
await user.save()      // matches on _id, so it actually updates
```

`_id` is immutable, so it is stripped from update payloads rather than sent and
rejected.

### Not supported

`belongsToMany()` and `hasManyThrough()` need a JOIN. The resolver declares
`supportsJoins = false`, so those relations throw a clear error instead of
silently ignoring the join and returning wrong rows. Use embedded arrays or an
aggregation pipeline via `DB.raw()`.

```js

// Nested document queries
await User.where('address.city', 'New York').get()
await User.where('settings.theme', 'dark').get()

// Array contains
await User.where('tags', 'javascript').get()
await User.whereJsonContains('permissions', 'admin').get()

// Text search (requires text index on collection)
await User.whereRaw({ $text: { $search: 'Alice' } }).get()

// Geospatial (raw query)
await User.whereRaw({
  location: {
    $near: { $geometry: { type: 'Point', coordinates: [-73.9, 40.7] }, $maxDistance: 5000 }
  }
}).get()
```

---

## Using with Multiple Connections

```js
import { connect } from '@eloquentjs/mongodb'
import { connect as pgConnect } from '@eloquentjs/pgsql'

// Connect both drivers — the second argument names the connection;
// `static connection` refers to it by that name, not by the resolver
// connect() returns.
await pgConnect({ host: 'localhost', database: 'app' })
await connect({ url: 'mongodb://localhost', database: 'analytics' }, 'analytics')

// Use MongoDB for specific models
class PageView extends Model {
  static connection = 'analytics'
  static table      = 'page_views'
}

// Other models still use PostgreSQL
class User extends Model {
  static table = 'users'
}
```

---

## Schema (Collections & Indexes)

MongoDB is schemaless, but you can manage indexes:

```js
import { Schema } from '@eloquentjs/core'

await Schema.create('users', col => {
  col.index('email', { unique: true })
  col.index({ name: 'text', bio: 'text' })   // text index
  col.index({ location: '2dsphere' })         // geo index
  col.index(['tenant_id', 'created_at'])      // compound index
})

await Schema.dropIfExists('old_collection')
await Schema.hasTable('users')
```

---

## Configuration Reference

| Option | Default | Description |
|---|---|---|
| `url` | `mongodb://localhost:27017` | MongoDB connection URL |
| `database` | — | Database name (required) |
| `username` | — | Auth username |
| `password` | — | Auth password |
| `authSource` | `admin` | Auth database |
| `tls` | `false` | Enable TLS |
| `replicaSet` | — | Replica set name |
| `maxPoolSize` | `10` | Max connection pool size |

---

## License

MIT
