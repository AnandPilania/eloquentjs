# The Resolver Contract

A **resolver** is a database driver. `@eloquentjs/core` never writes SQL, never
opens a connection, and never names a dialect — it builds a neutral *context
object* and hands it to a resolver, which does all translation and I/O.

Everything the ORM can do against a database goes through this one interface.
If you implement it, `Model`, `QueryBuilder`, relations, `Schema`, factories and
seeders all work unchanged.

Reference implementations, easiest to hardest to learn from:

| Driver | Notes |
|---|---|
| [`@eloquentjs/sqlite`](../sqlite/src/index.js) | Most complete. Shows placeholder rewriting, value normalization, and the create-copy-swap path around SQLite's `ALTER` limits. |
| [`@eloquentjs/pgsql`](../pgsql/src/index.js) | Pooling, transactions, `$N` numbering across sub-clauses. |
| [`@eloquentjs/mongodb`](../mongodb/src/index.js) | A non-SQL store. Shows which parts are genuinely optional and how to fail loudly on the rest. |

Verify your driver with the conformance suite — see [Conformance](#conformance)
at the bottom. Do not skip it: it is the only thing that catches a missing
method before a user does.

---

## Registering

Drivers expose a `connect()` that builds a resolver and registers it by name:

```js
import { setResolver } from '@eloquentjs/core'

export async function connect(config, connectionName = 'default') {
  const resolver = new MyResolver(await openConnection(config))
  setResolver(resolver, connectionName)   // note the argument order
  return resolver
}
```

`Model.getResolver()` looks up `getResolver(this.connection)`, so a model with
`static connection = 'analytics'` reaches the resolver registered under that
name. Hold one connection/pool **per name** — never a module-level singleton.

---

## The query context

Every read method receives a `ctx` built by `QueryBuilder._buildContext()`.
Treat it as the complete description of a query:

```js
{
  wheres:    [],      // see "Where types" below
  rawWheres: [{ sql, bindings }],
  selects:   ['*'] | ['id', 'name'] | [{ raw: 'COUNT(*) AS n' }],
  joins:     [{ type: 'INNER'|'LEFT'|'RIGHT'|'CROSS', table, first, operator, second }],
  orderBys:  [{ column, direction: 'ASC'|'DESC' } | { raw } | { random: true }],
  groupBys:  ['column'],
  havings:   [{ column, operator, value }],
  limit:     null | number,
  offset:    null | number,
  distinct:  false,
}
```

Any field may be absent — always read defensively (`ctx.joins ?? []`).

### Where types

Each entry carries `boolean: 'and' | 'or'`. Entries added by a global scope also
carry `_scope: '<name>'`; you do not need to interpret that tag, but do not drop
those entries.

| `type` | Shape | Meaning |
|---|---|---|
| *(absent)* | `{ column, operator, value }` | `column <op> value`. `operator` is upper-cased (`=`, `!=`, `>`, `LIKE`, `NOT LIKE`, …). |
| `in` / `notIn` | `{ column, values }` | An **empty** `values` must yield a constant-false (`in`) or constant-true (`notIn`) predicate, not an empty list. |
| `null` / `notNull` | `{ column }` | `IS [NOT] NULL`. |
| `between` / `notBetween` | `{ column, min, max }` | Inclusive. |
| `date` | `{ column, operator, value }` | Compare the **date part** only. |
| `year` / `month` / `day` | `{ column, value }` | Extract that part and compare for equality. |
| `jsonContains` | `{ column, value }` | Containment. Object → all key/value pairs match; array → all elements present; scalar → equality. |
| `group` | `{ wheres, rawWheres }` | **A nested, parenthesized sub-clause.** Recurse. |

#### `group` is not optional

`Model.query()` puts global scopes (soft deletes especially) in the same list as
user predicates. Flattened, `deleted_at IS NULL AND a = 1 OR b = 2` parses as
`(deleted_at IS NULL AND a = 1) OR b = 2` and returns rows the scope excluded.
Core therefore wraps the user predicates in a `group` whenever an `or` is
present, and expects you to emit real parentheses:

```sql
WHERE "deleted_at" IS NULL AND ("a" = $1 OR "b" = $2)
```

A `group` whose `wheres` are all empty must contribute **no** clause at all —
not `()`, and not a stray `AND`. `where(fn)` closures produce the same node, so
skipping this also silently breaks REST `?search=` and GraphQL `OR` filters.

### Combining precedence

`or` splits the list into runs; each run is `AND`-ed internally. So
`a OR b AND c` means `a OR (b AND c)`. The first entry's `boolean` is ignored.
Append `rawWheres` last, `AND`-ed.

---

## Required methods

All are `async`. `table` is always a plain string.

### Reads

| Method | Returns |
|---|---|
| `select(table, ctx)` | Array of plain row objects. |
| `aggregate(table, fn, column, ctx)` | A single number. `fn` ∈ `count`, `sum`, `avg`, `min`, `max`. `count` with `column = '*'` counts rows. |
| `toSQL(table, ctx)` | `{ sql, params }` for debugging. Must not execute. Non-SQL stores return their own query description. |

### Writes

| Method | Returns |
|---|---|
| `insert(table, data)` | The inserted row, including any generated primary key. Postgres uses `RETURNING *`; others read the row back. If the store returns an id under another name, expose it as `insertedId`. |
| `insertMany(table, rows)` | Array of inserted rows. Columns are the **union** of all row keys; a row missing a key gets `NULL`. Must be one round trip. An empty `rows` returns `[]` without touching the database. |
| `update(table, conditions, data, ctx = null)` | Number of affected rows. `conditions` is a plain `{key: value}` object for single-record saves; when `ctx` is given, use it instead for bulk updates. |
| `delete(table, conditions, ctx = null)` | Number of affected rows. Same `conditions`/`ctx` split. |
| `increment(table, column, amount, extra, ctx)` | Number of affected rows. `amount` may be negative (that is how `decrement` works). `extra` is additional columns to `SET` in the same statement. |
| `truncate(table)` | Removes all rows. |

Bind every value as a parameter. Pass every identifier through your own
quoting helper — core does not pre-quote, and `column` can be `table.column`.

### Relations

Both pivot methods take one options object:

```js
selectPivot({ mainTable, pivotTable, mainKey, pivotForeignKey, pivotRelatedKey, foreignId,  pivotColumns })
selectPivotMany({ ...same..., foreignIds })   // batched, for eager loading
```

Return related rows. Pivot columns listed in `pivotColumns` come back on each
row prefixed `_pivot_<column>`; the batched form additionally needs
`_pivot_foreign_id` so core can group rows back onto their parents.

```js
hasManyThrough({ relatedTable, throughTable, firstKey, secondKey, throughKey, parentId })
hasManyThroughMany({ ...same..., parentIds })
```

A store that cannot express these should **throw a clear error** rather than
return wrong data — see `@eloquentjs/mongodb`, which throws for pivots and is
honest about it.

### Schema

Driven by `Blueprint`; needed for migrations, not for querying.

| Method | Notes |
|---|---|
| `createTable(table, blueprint)` | |
| `alterTable(table, blueprint)` | |
| `dropTable(table, { ifExists = false })` | |
| `renameTable(from, to)` | |
| `hasTable(table)` → boolean | |
| `hasColumn(table, column)` → boolean | Schemaless stores may always return `true`. |
| `getColumnListing(table)` → `string[]` | |

A blueprint carries `{ columns, foreigns, indexes }`. Each column has `name`,
`type`, and the chainable flags `_nullable`, `_default`, `_unique`,
`primaryKey`, plus type-specific `length` / `precision` / `scale` /
`enumValues`.

#### Defaults need care

`col._default` is either a literal or a **SQL expression**, and telling them
apart is dialect work:

- A quoted literal is almost always what you want: `DEFAULT 'active'`, not
  `DEFAULT active` (an identifier reference, or a syntax error).
- `Blueprint.uuid()` emits the Postgres expression `gen_random_uuid()`. Map
  portable expressions to your dialect — SQLite has no uuid function and builds
  one from `randomblob()`.
- SQLite additionally requires non-constant defaults to be **parenthesized**:
  `DEFAULT (unixepoch())`, never `DEFAULT unixepoch()`.

Both SQL drivers have a local `formatDefault()`; copy the closest one.

---

## Optional methods

Absent is fine — core never calls these itself.

| Method | Notes |
|---|---|
| `raw(sql, params)` | Escape hatch. `@eloquentjs/mongodb` omits it. |
| `transaction(callback)` | Usually a module-level export from the driver, not a resolver method. Give the callback a client with the same interface, and roll back if it throws. |

---

## Conformance

`@eloquentjs/core/testing` exports two Jest suites. Add both to a test file in
your driver and they will tell you what is missing.

```js
import { describeResolverShape, describeResolverBehavior } from '@eloquentjs/core/testing'
import { MyResolver } from '../src/index.js'

// No database needed — checks that every required method exists.
describeResolverShape('MyResolver', () => new MyResolver(fakeConnection()))

// Needs a live database. Skips itself if `makeResolver` returns null.
describeResolverBehavior('MyResolver', {
  makeResolver: () => hasLiveDb() ? new MyResolver(openTestDb()) : null,
  createTable:  async (r) => r.raw(`CREATE TABLE conformance (...)`),
  supports:     { groups: true, jsonContains: true },
})
```

`describeResolverShape` is the one that would have caught `insertMany` being
absent from every driver while `Model.insert(rows)` documented it as working.

See [`tests/unit/ResolverConformance.test.js`](../../tests/unit/ResolverConformance.test.js)
for all three in-tree drivers wired up.
