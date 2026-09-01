# @eloquentjs/core

> The zero-dependency core of EloquentJS — Model, QueryBuilder, Relations, Events, Casts, Factories, and more.

```bash
npm install @eloquentjs/core
```

---

## What's Included

| Export | Description |
|---|---|
| `Model` | Base model class with full Eloquent API |
| `DB` | `DB.transaction()`, `DB.table()`, `DB.raw()` — the non-model entry points |
| `QueryBuilder` | Fluent chainable query builder |
| `Collection` | Array wrapper with map/filter/pluck/groupBy and more |
| `CastRegistry` | Type casting system (built-in + custom) |
| `EventEmitter` | Async global event bus |
| `HookRegistry` | Model lifecycle hooks + observer pattern |
| `Schema` | Migration schema builder |
| `Validator` | Rule-based input validation |
| `Pipeline` | Data transformation pipeline |
| `Factory` | Model factory for test data |
| `Seeder` | Database seeder base class |
| `ConnectionRegistry` | Multi-connection management |
| `RelationRegistry` | Relation type system |
| `errors` | Typed error classes |

---

## Model

```js
import { Model, Attribute } from '@eloquentjs/core'

class User extends Model {
  // ── Configuration ────────────────────────────────────────────────────────
  static table       = 'users'
  static primaryKey  = 'id'
  static fillable    = ['name', 'email', 'password']
  static hidden      = ['password']
  static appends     = ['full_name']      // virtual attributes included in toJSON()
  static timestamps  = true              // default true; adds created_at/updated_at
  static softDeletes = false             // set true to enable soft deletes
  static attributes  = { role: 'member' } // defaults for new instances
  static withRelations = ['profile']      // always eager-loaded (Laravel's $with)
  static touches     = ['post']           // bump the parent's updated_at on save

  static casts = {
    is_admin:   'boolean',
    score:      'integer',
    price:      'decimal:2',
    settings:   'json',
    tags:       'array',
    born_at:    'date',
    created_at: 'datetime',
  }

  // ── Relations ────────────────────────────────────────────────────────────
  posts()     { return this.hasMany(Post) }
  profile()   { return this.hasOne(Profile) }
  roles()     { return this.belongsToMany(Role, 'user_roles') }
  manager()   { return this.belongsTo(User, 'manager_id') }
  images()    { return this.morphMany(Image, 'imageable') }

  // ── Accessors & Mutators ─────────────────────────────────────────────────
  getFullNameAttribute() {
    return `${this.first_name} ${this.last_name}`
  }
  setPasswordAttribute(v) {
    return bcrypt.hashSync(v, 10)
  }

  // Laravel 9-style accessor/mutator pair, declared as a getter — a method
  // named `fullName()` would shadow the attribute on every read.
  get fullName() {
    return Attribute.make({
      get: (_, attrs) => `${attrs.first_name} ${attrs.last_name}`,
      set: value => {
        const [first_name, last_name] = value.split(' ')
        return { first_name, last_name }   // writes both columns at once
      },
    })
  }

  // ── Scopes ───────────────────────────────────────────────────────────────
  static scopeActive(qb)         { return qb.where('active', true) }
  static scopeOlderThan(qb, age) { return qb.where('age', '>', age) }

  // Global scopes (always applied)
  static globalScopes = {
    tenanted: qb => qb.where('tenant_id', currentTenantId()),
  }

  // ── Lifecycle Hooks ──────────────────────────────────────────────────────
  // Returning false from a "-ing" hook cancels the operation.
  static async retrieved(user) { }
  static async saving(user)    { }   // both insert and update
  static async creating(user)  { user.uuid = crypto.randomUUID() }
  static async created(user)   { await sendWelcomeEmail(user) }
  static async updating(user)  { if (user.locked) return false }
  static async updated(user)   { }
  static async saved(user)     { }
  static async deleting(user)  { await user.posts().delete() }
  static async deleted(user)   { }
  static async restoring(user) { }
  static async restored(user)  { }
}
```

Apply a local scope:

```js
await User.scope('active').get()
await User.scope('olderThan', 30).get()

// Or wrap the class so scopes become methods
import { withScopes } from '@eloquentjs/core'
const ScopedUser = withScopes(User)
await ScopedUser.active().get()
```

Observers and one-off hooks register against the class **reference**, so two
`User` classes from different modules don't collide and minification can't break
them:

```js
User.observe(new UserObserver())        // any of the events above
const off = User.on('created', fn)      // returns an unregister function
```

The string event bus (`EventEmitter.on('User:created', fn)`) fires from the same
dispatcher, so a listener registered either way runs exactly once per event.

---

## Query Builder

```js
// Fetch
await User.all()
await User.find(1)
await User.findOrFail(1)      // throws ModelNotFoundException
await User.findMany([1,2,3])
await User.first()
await User.firstOrFail()
await User.firstOrCreate({ email: 'a@b.com' }, { name: 'Alice' })
await User.updateOrCreate({ email: 'a@b.com' }, { name: 'Alice' })

// WHERE
await User.where('active', true).get()
await User.where('age', '>', 18).get()
await User.where({ active: true, is_admin: false }).get()
await User.whereNot('status', 'banned').get()
await User.whereIn('role', ['admin', 'editor']).get()
await User.whereNotIn('id', [1, 2, 3]).get()
await User.whereNull('deleted_at').get()
await User.whereNotNull('email_verified_at').get()
await User.whereBetween('age', [18, 65]).get()
await User.whereNotBetween('score', [0, 10]).get()
await User.whereLike('name', '%Alice%').get()
await User.whereDate('created_at', '2024-01-01').get()
await User.whereYear('created_at', 2024).get()
await User.whereMonth('created_at', 3).get()
await User.whereJsonContains('permissions', 'write').get()
await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).get()

// OR WHERE
await User.where('role', 'admin').orWhere('is_superuser', true).get()

// Scoped WHERE group
await User.where(qb => {
  qb.where('country', 'US').orWhere('country', 'CA')
}).get()

// ORDER / LIMIT / OFFSET
await User.orderBy('name').get()
await User.orderByDesc('created_at').get()
await User.latest().get()           // orderBy created_at desc
await User.oldest().get()           // orderBy created_at asc
await User.inRandomOrder().first()
await User.limit(10).offset(20).get()
await User.take(10).skip(20).get()  // aliases
await User.forPage(3, 15).get()     // page 3, 15 per page

// SELECT / DISTINCT
await User.select('id', 'name', 'email').get()
await User.addSelect('role').get()
await User.distinct().pluck('country')

// JOINS
await User.join('profiles', 'users.id', '=', 'profiles.user_id').get()
await User.leftJoin('posts', 'users.id', '=', 'posts.user_id').get()
await User.rightJoin('orders', 'users.id', '=', 'orders.user_id').get()

// GROUP BY / HAVING
await User.groupBy('country').select('country').count()
await User.groupBy('role').having('count(*)', '>', 5).get()

// AGGREGATES
await User.count()
await User.count('id')
await User.max('age')
await User.min('score')
await User.sum('balance')
await User.avg('score')
await User.exists()
await User.doesntExist()

// PAGINATION
const page = await User.paginate(1, 20)
// { data: User[], meta: { total, per_page, current_page, last_page, has_more } }

// cursorPaginate: keyset pagination, stable while rows are inserted/deleted
// elsewhere in the table — orders by primaryKey unless orderBy() sets another column
const first = await User.cursorPaginate(20)
// { data: User[], meta: { per_page, next_cursor, has_more } }
const next = await User.query().cursorPaginate(20, first.meta.next_cursor)

// UNION — combines two queries; this builder's ORDER BY/LIMIT apply to the
// combined result. Not supported on MongoDB (no find() equivalent).
await User.select('id', 'name').where('role', 'admin')
  .union(User.select('id', 'name').where('role', 'editor'))
  .orderBy('name')
  .get()

// EAGER LOADING
await User.with('posts', 'profile').get()
await User.with('posts.comments.author').get()
await User.with({ posts: qb => qb.where('published', true) }).get()

// CHUNK / STREAM (memory-efficient iteration)
await User.where('active', true).chunk(100, async (batch) => {
  await Promise.all(batch.map(u => processUser(u)))
})
// chunkById pages by primary key, so it is safe when the callback modifies rows
await User.query().chunkById(100, async batch => { /* ... */ })
for await (const user of User.query().lazy()) { /* one at a time */ }

// CONDITIONAL
await User.when(req.query.q, (qb, q) => qb.whereLike('name', `%${q}%`)).get()
await User.query().unless(includeDrafts, qb => qb.where('published', true)).get()

// REUSE — the builder is mutable, so clone() before branching
const base = User.where('active', true)
const [count, page] = await Promise.all([base.clone().count(), base.clone().paginate(1, 20)])

// LOCKING
await User.query().where('id', 1).lockForUpdate().first()

// RAW
await User.whereRaw('age > ?', [18]).get()
await User.selectRaw('count(*) as total').first()

// DEBUG
await User.where('active', true).dump()   // logs SQL + params, keeps going
```

Only whitelisted comparison operators reach the driver — the operator cannot be
a bound parameter, so `where(col, req.query.op, v)` would otherwise be an
injection point. Anything outside the list throws; use `whereRaw()` for the rest.

---

## Create / Update / Delete

```js
// Create
const user = await User.create({ name: 'Alice', email: 'a@b.com' })

// Update
await user.update({ name: 'Alicia' })
user.name = 'Alicia'
await user.save()

// Mass update
await User.where('active', false).update({ notified: true })

// Delete
await user.delete()                // soft delete if softDeletes=true
await user.forceDelete()           // always hard delete
await User.where('active', false).delete()

// Soft delete helpers
await user.restore()
await User.withTrashed().get()
await User.onlyTrashed().get()

// Prunable — bulk-delete rows matching a query, in chunks
class Post extends Model {
  static prunable() { return this.where('archived_at', '<', thirtyDaysAgo()) }
  static async pruning(post) { /* runs once per row, before delete */ }
}
await Post.prune()   // returns the number of rows deleted

// Increment / Decrement
await User.where('id', 1).increment('login_count')
await User.where('id', 1).decrement('credits', 10)
await User.where('id', 1).increment('score', 5, { last_activity: new Date() })

// Bulk insert-or-update
await User.upsert(rows, 'email')                    // update all non-key columns
await User.upsert(rows, 'email', ['name'])          // update only these
await User.updateOrInsert({ email }, { name })

// Dirty checking — pending changes
user.isDirty()         // true if any attribute changed
user.isDirty('name')   // true if 'name' changed
user.getDirty()        // ['name']
user.getOriginal()     // original values from DB

// …and what the LAST save() actually wrote
await user.save()
user.wasChanged()        // did the save write anything?
user.wasChanged('name')  // did it write this column?
user.getChanges()        // { name: { from: 'old', to: 'new' } }

// save() is a no-op when nothing is dirty — it does not touch updated_at
// just to have something to write.
await user.saveQuietly()            // save without touching timestamps
await User.withoutTimestamps(fn)    // for a whole block
await user.touch()                  // only bump updated_at
await user.push()                   // save this model and every loaded relation
const copy = user.replicate()       // unsaved copy, no id or timestamps
user.is(other)                      // same class and same primary key
```

### Mass assignment

`guarded` defaults to `['*']`, matching Laravel: **nothing is fillable until you
declare `fillable`.** With `strictFill = true` a blocked key throws
`MassAssignmentException` instead of being silently dropped.

```js
class User extends Model {
  static fillable = ['name', 'email']   // only these come from user input
  static strictFill = true              // fail loudly in development
}

User.create({ name: 'a', is_admin: true })   // is_admin is refused
user.forceFill({ is_admin: true })           // explicit bypass
await User.unguarded(() => User.create(trustedRow))
```

---

## Relations

```js
// One-to-one
class User extends Model {
  profile() { return this.hasOne(Profile) }
}
class Profile extends Model {
  user() { return this.belongsTo(User) }
}

// One-to-many
class Post extends Model {
  comments() { return this.hasMany(Comment) }
  user()      { return this.belongsTo(User) }
}

// Many-to-many with pivot
class User extends Model {
  roles() { return this.belongsToMany(Role, 'user_roles') }
}
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().detach(roleId)            // or detach([1, 2])
await user.roles().sync([1, 2, 3])           // or sync({ 1: { role: 'owner' } })
await user.roles().syncWithoutDetaching([4])
await user.roles().toggle(4)

const roles = await user.roles().withPivot('assigned_at').get()
roles[0].pivot.assigned_at        // pivot data lives on a relation accessor
user.roles().as('membership')     // rename it: roles[0].membership
user.roles().withTimestamps()     // maintain created_at/updated_at on the pivot
user.roles().wherePivot('assigned_at', '>', someDate)

// Has-many-through / has-one-through
class Country extends Model {
  posts()  { return this.hasManyThrough(Post, User, 'country_id', 'user_id') }
  latest() { return this.hasOneThrough(Post, User, 'country_id', 'user_id') }
}

// hasOne "of many" — the single latest/oldest related row, not all of them
class User extends Model {
  latestOrder() { return this.hasOne(Order).latestOfMany() }
  firstOrder()  { return this.hasOne(Order).oldestOfMany('created_at') }
  // or, for a non-timestamp column: hasOneOfMany(Order, 'total', 'MAX')
  biggestOrder() { return this.hasOneOfMany(Order, 'total', 'MAX') }
}

// Polymorphic
class Image extends Model {
  imageable() { return this.morphTo('imageable') }
}
class User extends Model {
  images() { return this.morphMany(Image, 'imageable') }
  tags()   { return this.morphToMany(Tag, 'taggable') }
}

// Register a morph alias so a class rename doesn't orphan existing rows.
// Without this, `*_type` stores the raw class name.
import { ModelRegistry } from '@eloquentjs/core'
ModelRegistry.morphMap({ user: User, post: Post })

// Relation writes
await user.posts().create({ title: 'Hello' })
await user.posts().saveMany([post1, post2])
await user.posts().firstOrCreate({ slug: 'hello' }, { title: 'Hello' })
await user.posts().updateOrCreate({ slug: 'hello' }, { title: 'Hi' })

// A to-one relation can return a default instead of null
const profile = await user.profile().withDefault({ bio: 'None yet' })
```

### A relation is a query builder

Every builder method is available on the relation and constrains the database
query, not the result in memory:

```js
await user.posts().where('published', true).latest().limit(5).get()
await user.posts().where('published', true).count()
await user.posts().paginate(1, 20)
await user.posts().pluck('title')
for await (const post of user.posts().lazy()) { /* streamed */ }

user.posts().getQuery()    // the underlying QueryBuilder, if you need it
```

### Relationship queries

```js
await User.whereHas('posts').get()
await User.whereHas('posts', qb => qb.where('published', true)).get()
await User.whereDoesntHave('posts').get()

const users = await User.withCount('posts').get()
users[0].posts_count       // one aggregate query for the whole batch

await User.withSum('orders', 'total').get()   // orders_sum_total
await User.withExists('posts').get()          // posts_exists
```

---

## Transactions

```js
import { DB } from '@eloquentjs/core'

// Every model write inside — including in anything the callback awaits — runs
// on the transaction's connection. A throw rolls all of it back.
await DB.transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
})

await DB.transaction(callback, 'primary')   // a named connection
DB.inTransaction()                          // true inside the callback

// Nested calls become savepoints where the driver supports them
await DB.transaction(async () => {
  await Account.create({ name: 'outer' })
  try {
    await DB.transaction(async () => { throw new Error('inner') })
  } catch { /* 'outer' survives */ }
})

// Query a bare table, no model class needed
await DB.table('users').where('email', email).count()
await DB.raw('SELECT 1')
```

---

## Collections

```js
const users = await User.all()   // returns Collection

users.first()                    // or first(fn)
users.last()
users.sole()                     // exactly one, or throw
users.pluck('email')             // Collection ['a@b.com', ...]
users.pluck('email', 'id')       // Map { 1 => 'a@b.com' }
users.groupBy('country')         // Map { 'US' => Collection, ... }
users.keyBy('id')                // Map { 1 => user, ... }
users.modelKeys()                // Collection of primary keys
users.where('is_admin', true)
users.whereIn('role', ['admin', 'editor'])
users.contains('email', 'a@b.com')
users.partition(u => u.is_admin) // [admins, others]
users.sortBy('name')
users.sortBy('age', 'desc')
users.chunk(10)                  // Collection of Collections
users.sum('balance')
users.avg('score')
users.median('score')
users.min('age')                 // null when empty
users.implode('name', ', ')
users.unique('email')
users.random(3)
users.shuffle()
users.only('id', 'name', 'email')
users.except('password')
users.mapInto(UserDTO)
users.each(user => ...)          // return false to stop
users.tap(col => console.log(col.length))
users.when(condition, col => col.where('active', true))
users.toArray()
users.toJSON()

// Lazy eager loading, after the fact
await users.load('posts')
await users.loadMissing('profile')
await user.load('posts.comments')
```

`groupBy`, `keyBy` and `pluck(v, k)` return `Map`s, not plain objects: object
keys coerce to strings, and a key of `__proto__` mis-keys or throws. `where()`,
`whereIn()`, `sum()`, `min()` and `max()` all read through `getAttribute()`, so
casts and accessors apply consistently.

---

## Casting

```js
// Built-in cast types
static casts = {
  is_admin:   'boolean',           // true/false
  score:      'integer',           // parseInt
  price:      'decimal:2',         // number in memory, fixed string in JSON
  rating:     'float',
  born_at:    'date',              // Date object
  created_at: 'datetime',          // Date object
  settings:   'json',              // JSON.parse/stringify
  tags:       'array',             // JSON array
  published_at: 'immutable_date',  // frozen Date copy on read
  password:   'hashed',            // scrypt on write; never serialised
  status:     AsEnum(Status),      // only values the enum contains
  tag_list:   AsCollection,        // JSON array read back as a Collection
  options:    AsArrayObject,       // JSON object read back as a plain object; null reads as {}
}

// `hashed` columns are verified, not compared
import { verifyHashed } from '@eloquentjs/core'
verifyHashed(submitted, user.getRawAttribute('password'))

// Custom cast class
class MoneyAmountCast {
  get(v)       { return v == null ? v : { amount: v, formatted: `$${v.toFixed(2)}` } }
  set(v)       { return typeof v === 'object' ? v.amount : v }
  serialize(v) { return v?.amount ?? v }
}

class Order extends Model {
  static casts = { total: MoneyAmountCast }
}

// Register globally by string name
CastRegistry.register('money', MoneyAmountCast)
// then use: static casts = { total: 'money' }
```

One instance per cast class is shared, so `this` inside a cast is stable and a
`serialize()` that uses it works. Cast instances are not created per attribute
access.

---

## Migrations

```js
import { Schema, Migration, Expr } from '@eloquentjs/core'

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create('users', t => {
      t.id()                                  // bigIncrements primary key
      t.uuid('public_id')                     // uuid PK, defaults to Expr.uuid
      t.string('email').unique()              // a named, droppable unique index
      t.string('name').index()                // a real index — used to be a no-op
      t.unsignedInteger('login_count').default(0)
      t.timestamp('verified_at').nullable()
      t.timestamp('seen_at').useCurrent()     // Expr.now, rendered per driver
      t.foreignId('role_id').cascadeOnDelete().constrained('roles')
      t.timestamps()
      t.softDeletes()
    })
  }

  async down() {
    await Schema.dropIfExists('users')
  }
}
```

Altering an existing table:

```js
await Schema.table('users', t => {
  t.string('nickname').nullable()          // ADD COLUMN
  t.string('name', 500).change()           // ALTER the column's type
  t.index(['tenant_id', 'created_at'])     // applied on alter too, not just create
  t.foreignId('team_id').constrained('teams')
  t.dropColumn('legacy_flag')
  t.renameColumn('bio', 'about')
  t.dropUnique('users_email_unique')
})
```

Notes that matter across drivers:

- Core emits **portable default markers** (`Expr.uuid`, `Expr.now`,
  `Expr.today`), never dialect SQL. Each driver renders them: Postgres uses
  `gen_random_uuid()`, SQLite builds a v4 from `randomblob()`.
- Constraint names come from core, so a migration written against one driver can
  be rolled back against another: `users_email_unique`, `posts_user_id_foreign`.
- `Schema.drop()` and `Model.truncate()` **never cascade implicitly**. Pass
  `{ cascade: true }` when you mean it.
- SQLite rebuilds the table for operations it cannot do in place; that is handled
  for you.

---

## Validation

The core `Validator` handles 30+ rules with no dependencies. Rules may be an
array or Laravel's pipe string; `@eloquentjs/validator` subclasses this one, so
each rule name has exactly one implementation.

```js
import { Validator } from '@eloquentjs/core'

const v = Validator.make(data, {
  name:     ['required', 'string', 'min:2', 'max:100'],
  email:    'required|email|unique:users,email',   // pipe syntax works too
  age:      ['required', 'integer', 'min:18'],     // numeric, not string length
  bio:      ['nullable', 'string'],                // empty → skip the rest
  password: ['required', 'min:8', 'confirmed'],
  role:     ['required', 'in:admin,editor,viewer'],
}, {
  // Optional custom messages
  'email.required': 'We need your email address.',
  'email.email':    'That email address looks invalid.',
})

if (v.fails()) {
  return res.status(422).json({ errors: v.errors })
}

const data = v.validated()  // throws ValidationException if invalid; returns declared fields only
```

`unique` and `exists` query the database, so they only run on the async path:

```js
if (await v.failsAsync()) return res.status(422).json({ errors: v.errors })
const data = await v.validatedAsync()
```

A sync `validate()` **skips** them rather than reporting them as passed, and a
database error surfaces rather than being swallowed into "valid". An unknown rule
name throws, so a typo can't silently pass.

For the **fluent schema API** (`v.string().email().unique(...)`), **wildcard
paths** (`items.*.price`), **custom Rule classes**, `after()` hooks and
**Express/Fastify adapters**, use [`@eloquentjs/validator`](../validator/README.md):

```js
import { v, Rule } from '@eloquentjs/validator'
import { expressValidate } from '@eloquentjs/validator/adapters'

const schema = v.schema({
  email: v.string().email().unique('users', 'email'),  // async DB check
  age:   v.number().integer().min(18).optional(),
})

// Middleware — validates and populates req.validated
router.post('/users', expressValidate(schema, { async: true }), handler)
```

---

## Pipeline

```js
import { Pipeline } from '@eloquentjs/core'

const result = await Pipeline
  .send(userData)
  .through(
    ValidateInput,           // a class (or instance) with a handle(data) method
    SanitizeEmail,
    HashPassword,
    async (data) => ({ ...data, slug: slugify(data.name) }),   // or a function
  )
  .thenReturn()

// Or hand the result to a final destination (Laravel spells this `->then(fn)`;
// `then` here is the promise protocol, so the pipeline can be awaited directly)
await Pipeline.send(userData).through(...steps).thenTo(data => User.create(data))
```

---

## Factories & Seeders

```js
import { Factory, Seeder } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'

class UserFactory extends Factory {
  static model = User
  definition() {
    return {
      name:     faker.person.fullName(),
      email:    faker.internet.email(),
      password: 'password',
      is_admin: false,
    }
  }
  admin()    { return this.state({ is_admin: true }) }
  verified() { return this.state({ email_verified_at: new Date() }) }
}

const user  = await UserFactory.new().create()
const admin = await UserFactory.new().admin().create()
const users = await UserFactory.new().count(50).create()   // a Collection

// Cycle values across rows
await UserFactory.new().count(4).sequence({ role: 'admin' }, { role: 'editor' }).create()

// Relations
await UserFactory.new().has(PostFactory.new().count(3), 'posts').create()
await PostFactory.new().count(5).for(user, 'author').create()

// Just the attributes, or a model without saving, or no events
const attrs = UserFactory.new().raw()
const made  = await UserFactory.new().make()
await UserFactory.new().createQuietly()
```

Factories `forceFill`: seed data is trusted, and since `guarded` defaults to
`['*']`, going through mass assignment would drop every attribute on a model
that hasn't declared `fillable`.

`definition()` must import its own faker — no package declares
`@faker-js/faker` as a dependency, so add it to your project:

```bash
npm install --save-dev @faker-js/faker
```

```js
// Seeder
class DatabaseSeeder extends Seeder {
  async run() {
    await this.call(UserSeeder, PostSeeder)
  }
}
class UserSeeder extends Seeder {
  async run() {
    await UserFactory.new().count(100).create()
  }
}
```

---

## Error Classes

```js
import { errors } from '@eloquentjs/core'

// ModelNotFoundException   — thrown by findOrFail(), firstOrFail()
// ValidationException      — thrown by Validator.validated()
// MassAssignmentException  — thrown on guarded attribute write
```

---

## License

MIT
