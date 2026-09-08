# @eloquentjs/mysql

> MySQL driver for EloquentJS. Wraps `mysql2` with a full query resolver, schema builder, and transaction support.

```bash
npm install @eloquentjs/core @eloquentjs/mysql
```

This driver depends on [`mysql2`](https://www.npmjs.com/package/mysql2), which is installed
automatically as a dependency — you do not need to install it separately.

---

## Setup

```js
import { connect } from '@eloquentjs/mysql'
import { Model } from '@eloquentjs/core'

await connect({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 3306),
  database: process.env.DB_DATABASE ?? 'myapp',
  user:     process.env.DB_USERNAME ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
})

// Or connect with a connection URL
await connect({ url: process.env.DATABASE_URL })

class User extends Model {
  static table = 'users'
}
await User.find(1)  // queries MySQL
```

---

## Multiple Connections

Each call to `connect()` creates a **separate connection pool** for that named connection. Calling `connect()` a second time with the same name safely closes and replaces the old pool.

```js
import { connect, disconnect, getPool } from '@eloquentjs/mysql'

const primary = await connect({ host: 'primary.db', database: 'app' }, 'primary')
const pool = getPool('primary')
await disconnect('primary')
await disconnect() // all connections
```

---

## Transactions

Prefer the driver-agnostic facade — it works identically on every driver:

```js
import { DB } from '@eloquentjs/core'

await DB.transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
})
```

Nested calls become SAVEPOINTs, same as `@eloquentjs/pgsql`.

---

## Raw Queries

```js
import { raw } from '@eloquentjs/mysql'

// Raw query with parameterized values (uses default connection)
const rows = await raw(
  'SELECT * FROM users WHERE age > ? AND country = ?',
  [18, 'US']
)

// Named connection
const rows = await raw('SELECT * FROM archive_events', [], 'archive')

// Inside a model query
await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).first()
await User.selectRaw('count(*) as total, country').groupBy('country').get()
```

---

## Schema Builder

```js
import { Schema } from '@eloquentjs/core'

// CREATE TABLE
await Schema.create('users', t => {
  t.id()                                         // INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
  t.uuid('uuid').unique()                        // CHAR(36)
  t.string('name')                               // VARCHAR(255)
  t.string('email', 191).unique()                // VARCHAR(191) UNIQUE
  t.text('bio').nullable()
  t.integer('age').nullable()
  t.bigInteger('score').default(0)
  t.decimal('price', 8, 2).default(0)
  t.boolean('is_active').default(true)           // TINYINT(1)
  t.json('settings').nullable()
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

`t.increments()`/`t.bigIncrements()` render as `INT UNSIGNED AUTO_INCREMENT`/
`BIGINT UNSIGNED AUTO_INCREMENT` — MySQL's equivalent of Postgres's
`SERIAL`/`BIGSERIAL`. Identifiers are quoted with backticks (`` `table` ``),
not double quotes.

---

## Notes vs. Postgres/SQLite

- MySQL has no `RETURNING` clause. `insert()`/`insertMany()` re-select the inserted row(s) by `insertId`, assuming the table's primary key column is named `id` (the same convention `Blueprint`'s `t.id()`/`t.bigIncrements()` use elsewhere in this project).
- `upsert()` uses `INSERT ... ON DUPLICATE KEY UPDATE`, so `uniqueBy` must name a column covered by a `UNIQUE`/`PRIMARY` index.
- No native `JSONB` — `jsonb()` columns map to `JSON`.
- `TRUNCATE` always resets `AUTO_INCREMENT`; `restartIdentity` is a no-op.
- `truncate(table, { cascade: true })` toggles `FOREIGN_KEY_CHECKS` off for the
  duration of the `TRUNCATE` (then back on), since MySQL's `TRUNCATE` has no
  `CASCADE` keyword — this is the MySQL equivalent of Postgres's
  `TRUNCATE ... CASCADE`.

---

## Configuration Reference

| Option | Default | Description |
|---|---|---|
| `host` | `localhost` | MySQL server host |
| `port` | `3306` | MySQL port |
| `database` | — | Database name (required). Alias: `db` |
| `user` | — | Username (required). Alias: `username` |
| `password` | — | Password. Alias: `pass` |
| `ssl` | — | Enable TLS/SSL |
| `poolSize` | `10` | Max pool connections (`connectionLimit`) |
| `url` | — | Full connection URL (overrides above) |

---

## License

MIT
