# @eloquentjs/pgsql

> PostgreSQL driver for EloquentJS. Wraps `pg` with a full query resolver, schema builder, and transaction support.

```bash
npm install @eloquentjs/core @eloquentjs/pgsql
```

---

## Setup

```js
import { connect } from '@eloquentjs/pgsql'
import { Model } from '@eloquentjs/core'

// Connect with options object
await connect({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_DATABASE ?? 'myapp',
  user:     process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  ssl:      process.env.DB_SSL === 'true',
  // Pool settings (optional)
  max:      10,
  idleTimeoutMillis: 30000,
})

// Or connect with a connection URL
await connect({ url: process.env.DATABASE_URL })

// Now all Models use this connection automatically
class User extends Model {
  static table = 'users'
}
await User.find(1)  // queries PostgreSQL
```

---

## Multiple Connections

Each call to `connect()` creates a **separate connection pool** for that named connection. Calling `connect()` a second time with the same name safely closes and replaces the old pool.

```js
import { connect, disconnect, getPool } from '@eloquentjs/pgsql'

const primary  = await connect({ host: 'primary.db',  database: 'app' }, 'primary')
const replica  = await connect({ host: 'replica.db',  database: 'app' }, 'replica')
const archive  = await connect({ url: process.env.ARCHIVE_URL },         'archive')

// Per-model connection
class AnalyticsEvent extends Model { static connection = 'replica' }
class ArchiveLog     extends Model { static connection = 'archive' }

// Access the raw pg.Pool for a named connection
const pool = getPool('primary')

// Disconnect a specific connection
await disconnect('replica')

// Disconnect all connections (e.g. on process shutdown)
await disconnect()
```

---

## Transactions

```js
import { transaction } from '@eloquentjs/pgsql'

// All operations inside share one connection and are rolled back on error
await transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
  await user.roles().attach(adminRoleId)
  // Any thrown error → automatic rollback
})

// Use a named connection for transactions
await transaction(callback, 'primary')
```

---

## Raw Queries

```js
import { raw } from '@eloquentjs/pgsql'

// Raw query with parameterized values (uses default connection)
const rows = await raw(
  'SELECT * FROM users WHERE age > $1 AND country = $2',
  [18, 'US']
)

// Named connection
const rows = await raw('SELECT * FROM archive_events', [], 'archive')

// Inside a model query
await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).first()
await User.selectRaw('count(*) as total, country').groupBy('country').get()
```

```js
import { Schema } from '@eloquentjs/core'

// CREATE TABLE
await Schema.create('users', t => {
  t.id()                                         // SERIAL PRIMARY KEY
  t.uuid('uuid').unique()                        // UUID column
  t.string('name')                               // VARCHAR(255)
  t.string('email', 191).unique()                // VARCHAR(191) UNIQUE
  t.text('bio').nullable()
  t.integer('age').nullable()
  t.bigInteger('score').default(0)
  t.decimal('price', 8, 2).default(0)
  t.boolean('is_active').default(true)
  t.json('settings').nullable()
  t.jsonb('meta').nullable()
  t.date('born_at').nullable()
  t.timestamp('email_verified_at').nullable()
  t.timestamps()                                 // created_at + updated_at
  t.softDeletes()                                // deleted_at
  t.foreignId('user_id').constrained('users').cascadeOnDelete()
  t.index(['name', 'email'])
  t.unique(['email', 'tenant_id'])
})

// ALTER TABLE
await Schema.table('users', t => {
  t.string('avatar_url').nullable()
  t.dropColumn('old_field')
  t.index('email')
})

// Other operations
await Schema.dropIfExists('old_table')
await Schema.rename('old_name', 'new_name')
await Schema.hasTable('users')                   // → true/false
await Schema.hasColumn('users', 'email')         // → true/false
await Schema.getColumnListing('users')           // → ['id', 'name', ...]
```

---

---

## Schema Builder

```js
import { Schema } from '@eloquentjs/core'

// CREATE TABLE
await Schema.create('users', t => {
  t.id()                                         // SERIAL PRIMARY KEY
  t.uuid('uuid').unique()                        // UUID column
  t.string('name')                               // VARCHAR(255)
  t.string('email', 191).unique()                // VARCHAR(191) UNIQUE
  t.text('bio').nullable()
  t.integer('age').nullable()
  t.bigInteger('score').default(0)
  t.decimal('price', 8, 2).default(0)
  t.boolean('is_active').default(true)
  t.json('settings').nullable()
  t.jsonb('meta').nullable()
  t.date('born_at').nullable()
  t.timestamp('email_verified_at').nullable()
  t.timestamps()                                 // created_at + updated_at
  t.softDeletes()                                // deleted_at
  t.foreignId('user_id').constrained('users').cascadeOnDelete()
  t.index(['name', 'email'])
  t.unique(['email', 'tenant_id'])
})

// ALTER TABLE
await Schema.table('users', t => {
  t.string('avatar_url').nullable()
  t.dropColumn('old_field')
  t.index('email')
})

// Other operations
await Schema.dropIfExists('old_table')
await Schema.rename('old_name', 'new_name')
await Schema.hasTable('users')                   // → true/false
await Schema.hasColumn('users', 'email')         // → true/false
await Schema.getColumnListing('users')           // → ['id', 'name', ...]
```

---

## Migration Concurrency Protection

When running migrations from multiple processes simultaneously (e.g. two deploy pipelines), EloquentJS uses PostgreSQL advisory locks to ensure only one process runs migrations at a time:

```js
// Handled automatically by `eloquent migrate`
// If another process is already migrating:
// → throws "Another migration process is running. Please wait and try again."
```

---

## Configuration Reference

| Option | Default | Description |
|---|---|---|
| `host` | `localhost` | PostgreSQL server host |
| `port` | `5432` | PostgreSQL port |
| `database` | — | Database name (required) |
| `user` | — | Username (required) |
| `password` | — | Password |
| `ssl` | `false` | Enable TLS/SSL |
| `max` | `10` | Max pool connections |
| `min` | `0` | Min pool connections |
| `idleTimeoutMillis` | `30000` | Idle connection timeout |
| `connectionTimeoutMillis` | `2000` | Connect attempt timeout |
| `url` | — | Full connection URL (overrides above) |

---

## License

MIT
