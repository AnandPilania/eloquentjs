# @eloquentjs/sqlite

> SQLite driver for EloquentJS. Uses Bun's native `bun:sqlite` when running in Bun and `better-sqlite3` elsewhere, with query resolver, schema builder, table rebuild migrations, and transaction support.

```bash
npm install @eloquentjs/core @eloquentjs/sqlite
```

---

## Setup

```js
import { connect } from '@eloquentjs/sqlite'
import { Model } from '@eloquentjs/core'

// File-backed database
await connect({ filename: process.env.SQLITE_DATABASE ?? 'database/database.sqlite' })

// Or an in-memory database, useful for tests
await connect({ filename: ':memory:' })

class User extends Model {
  static table = 'users'
}

await User.find(1)  // queries SQLite
```

In Bun, the driver automatically uses `bun:sqlite`. In Node.js and other runtimes, it uses the optional `better-sqlite3` backend.

---

## Multiple Connections

Each call to `connect()` creates a separate database handle for that named connection. Calling `connect()` again with the same name closes and replaces the old handle.

```js
import { connect, disconnect, getDb } from '@eloquentjs/sqlite'

await connect({ filename: 'database/app.sqlite' }, 'primary')
await connect({ filename: ':memory:' }, 'testing')

class AuditLog extends Model {
  static connection = 'primary'
}

const db = getDb('primary')

await disconnect('testing')
await disconnect() // disconnect all
```

---

## Transactions

```js
import { DB } from '@eloquentjs/core'

// Model writes inside run on the transaction; a throw rolls all of them back.
await DB.transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
})

// The driver export is equivalent
import { transaction } from '@eloquentjs/sqlite'
await transaction(callback, 'primary')
```

Nested calls become `SAVEPOINT`s, so an inner failure rolls back only its own
work.

> **SQLite has one connection.** Anything else running on the same connection
> while a transaction is open — a query from a concurrent request, say — is
> inside that transaction and will be rolled back with it. That is a property of
> the database, not of this driver: use one connection per process and do not
> interleave unrelated work across an `await` inside the callback.

---

## Raw Queries

```js
import { raw } from '@eloquentjs/sqlite'

// SQLite uses ? internally, but PostgreSQL-style $1 placeholders are accepted.
const rows = await raw(
  'SELECT * FROM users WHERE age > $1 AND country = $2',
  [18, 'US']
)

const archiveRows = await raw('SELECT * FROM archive_events', [], 'archive')

await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).first()
await User.selectRaw('count(*) as total, country').groupBy('country').get()
```

---

## Schema Builder

```js
import { Schema } from '@eloquentjs/core'

await Schema.create('users', t => {
  t.id()                                  // INTEGER PRIMARY KEY AUTOINCREMENT
  t.string('name')                        // TEXT
  t.string('email').unique()              // TEXT UNIQUE
  t.text('bio').nullable()
  t.integer('age').nullable()
  t.decimal('price', 8, 2).default(0)     // NUMERIC
  t.boolean('is_active').default(true)    // INTEGER (1/0)
  t.json('settings').nullable()           // TEXT
  t.timestamp('email_verified_at').nullable()
  t.timestamps()                          // created_at + updated_at as TEXT
  t.softDeletes()                         // deleted_at as TEXT
  t.foreignId('user_id').constrained('users').cascadeOnDelete()
  t.index(['name', 'email'])
})

await Schema.table('users', t => {
  t.string('avatar_url').nullable()
  t.renameColumn('name', 'full_name')
  t.dropColumn('bio')
  t.dropForeign('users_user_id_foreign')
})

await Schema.dropIfExists('old_table')
await Schema.rename('old_name', 'new_name')
await Schema.hasTable('users')
await Schema.hasColumn('users', 'email')
await Schema.getColumnListing('users')
```

---

## SQLite Table Rebuilds

SQLite cannot apply many schema changes in place. When needed, this driver keeps the migration API the same and internally rebuilds the table.

Table rebuilds are used for:

- adding or dropping foreign keys
- dropping columns
- renaming columns
- dropping unique/index constraints
- adding primary or unique columns through `Schema.table()`
- dropping primary keys where SQLite can represent the result

The rebuild flow creates a temporary table, copies compatible data, swaps the table names, recreates indexes, and runs `PRAGMA foreign_key_check` before committing.

Limitations:

- Complex expression indexes and partial indexes are not preserved.
- Renaming a column referenced by foreign keys in other tables is not globally rewritten.
- SQLite rowid semantics can make `dropPrimary()` nuanced for `INTEGER PRIMARY KEY` columns.

---

## Configuration Reference

| Option | Default | Description |
|---|---|---|
| `filename` | `:memory:` | SQLite database file path |
| `database` | — | Alias for `filename` |
| `path` | — | Alias for `filename` |
| `foreignKeys` | `true` | Enable `PRAGMA foreign_keys = ON` |
| `wal` | `false` | Enable `PRAGMA journal_mode = WAL` |
| `options` | `{}` | Runtime-specific database constructor options |

---

## License

MIT
