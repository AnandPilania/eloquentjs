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

`belongsToMany()` needs a pivot-table JOIN, which MongoDB has no equivalent
for. The resolver declares `supportsJoins = false`, and `selectPivot`/
`selectPivotMany` throw a clear error instead of silently ignoring the join
and returning wrong rows. Use embedded arrays or an aggregation pipeline via
`DB.raw()`.

`hasManyThrough()` / `hasOneThrough()` **are** supported — no join is needed,
just two sequential queries (through-table first, then the related
collection filtered by the ids found).

`union()` is also not supported — SQL `UNION` has no equivalent `find()`
semantics in MongoDB, so a query using it throws.

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

await Schema.rename('old_collection', 'new_collection')
await Schema.dropIfExists('old_collection')
await Schema.hasTable('users')
```

---

## Transactions

Prefer the driver-agnostic facade — it works identically on every driver:

```js
import { DB } from '@eloquentjs/core'

await DB.transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
  // Any thrown error aborts the transaction, and none of the above is durable
})

await DB.transaction(callback, 'analytics')   // a named connection
```

The driver export is equivalent and delegates to the same implementation:

```js
import { transaction } from '@eloquentjs/mongodb'

await transaction(async (tx) => {
  await User.create({ name: 'Alice' })   // runs inside the session's transaction
})
```

MongoDB has no savepoints, so a nested `transaction()` call just joins the
outer one rather than creating a new checkpoint.

> **Requires a replica set or sharded cluster.** MongoDB transactions are
> **not supported against a standalone `mongod`** — the exact setup shown in
> this README's own Setup section (`mongodb://localhost:27017` with no
> replica set) will throw when `transaction()`/`DB.transaction()` is called.
> For local development, run MongoDB as a single-node replica set (e.g.
> `mongod --replSet rs0` + `rs.initiate()`), or use Atlas/a real replica set
> in any environment that needs transactions.

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
| `maxPoolSize` | driver default (100) | Max connection pool size — passed straight through to the `mongodb` driver; this package does not set its own default |

---

## License

MIT
