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

## Notes vs. Postgres/SQLite

- MySQL has no `RETURNING` clause. `insert()`/`insertMany()` re-select the inserted row(s) by `insertId`, assuming the table's primary key column is named `id` (the same convention `Blueprint`'s `t.id()`/`t.bigIncrements()` use elsewhere in this project).
- `upsert()` uses `INSERT ... ON DUPLICATE KEY UPDATE`, so `uniqueBy` must name a column covered by a `UNIQUE`/`PRIMARY` index.
- No native `JSONB` — `jsonb()` columns map to `JSON`.
- `TRUNCATE` always resets `AUTO_INCREMENT`; `restartIdentity` is a no-op.

---

## License

MIT
