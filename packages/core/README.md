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
import { Model } from '@eloquentjs/core'

class User extends Model {
  // ── Configuration ────────────────────────────────────────────────────────
  static table       = 'users'
  static primaryKey  = 'id'
  static fillable    = ['name', 'email', 'password']
  static hidden      = ['password']
  static appends     = ['full_name']      // virtual attributes included in toJSON()
  static timestamps  = true              // default true; adds created_at/updated_at
  static softDeletes = false             // set true to enable soft deletes

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

  // ── Scopes ───────────────────────────────────────────────────────────────
  static scopeActive(qb)         { return qb.where('active', true) }
  static scopeOlderThan(qb, age) { return qb.where('age', '>', age) }

  // Global scopes (always applied)
  static globalScopes = {
    tenanted: qb => qb.where('tenant_id', currentTenantId()),
  }

  // ── Lifecycle Hooks ──────────────────────────────────────────────────────
  static async creating(user) { user.uuid = crypto.randomUUID() }
  static async created(user)  { await sendWelcomeEmail(user) }
  static async updating(user) { }
  static async updated(user)  { }
  static async deleting(user) { await user.posts().delete() }
  static async deleted(user)  { }
}
```

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

// EAGER LOADING
await User.with('posts', 'profile').get()
await User.with('posts.comments.author').get()
await User.with({ posts: qb => qb.where('published', true) }).get()

// CHUNK (memory-efficient iteration)
await User.where('active', true).chunk(100, async (batch) => {
  await Promise.all(batch.map(u => processUser(u)))
})

// RAW
await User.whereRaw('age > ?', [18]).get()
await User.selectRaw('count(*) as total').first()
```

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

// Increment / Decrement
await User.where('id', 1).increment('login_count')
await User.where('id', 1).decrement('credits', 10)
await User.where('id', 1).increment('score', 5, { last_activity: new Date() })

// Dirty checking
user.isDirty()         // true if any attribute changed
user.isDirty('name')   // true if 'name' changed
user.getDirty()        // { name: 'new value' }
user.getOriginal()     // original values from DB
user.wasChanged('name')
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
await user.roles().detach(roleId)
await user.roles().sync([1, 2, 3])
await user.roles().toggle(4)
const roles = await user.roles()
roles[0]._pivot.assigned_at  // access pivot data

// Has-many-through
class Country extends Model {
  posts() { return this.hasManyThrough(Post, User, 'country_id', 'user_id') }
}

// Polymorphic
class Image extends Model {
  imageable() { return this.morphTo('imageable') }
}
class User extends Model {
  images() { return this.morphMany(Image, 'imageable') }
}

// Relation writes
await user.posts().create({ title: 'Hello' })
await user.posts().saveMany([post1, post2])
```

---

## Collections

```js
const users = await User.all()   // returns Collection

users.first()
users.last()
users.pluck('email')             // ['a@b.com', ...]
users.groupBy('country')         // { US: [...], CA: [...] }
users.keyBy('id')                // { 1: user, 2: user }
users.where('is_admin', true)
users.sortBy('name')
users.sortBy('age', 'desc')
users.chunk(10)                  // Collection of Collections
users.sum('balance')
users.avg('score')
users.unique('email')
users.only('id', 'name', 'email')
users.except('password')
users.mapInto(UserDTO)
users.each(user => console.log(user.name))
users.tap(col => console.log(col.length))
users.when(condition, col => col.where('active', true))
users.toArray()
users.toJSON()
```

---

## Casting

```js
// Built-in cast types
static casts = {
  is_admin:   'boolean',    // true/false
  score:      'integer',    // parseInt
  price:      'decimal:2',  // toFixed(2) as number
  rating:     'float',
  born_at:    'date',       // Date object
  created_at: 'datetime',   // Date object
  settings:   'json',       // JSON.parse/stringify
  tags:       'array',      // JSON array
}

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

---

## Validation

The core `Validator` handles sync validation with 25+ rules — no dependencies required.

```js
import { Validator } from '@eloquentjs/core'

const v = Validator.make(data, {
  name:     ['required', 'string', 'min:2', 'max:100'],
  email:    ['required', 'email'],
  age:      ['required', 'integer', 'min:18'],
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

For **async rules** (`unique`, `exists`), **fluent schema API** (`v.string().email().unique(...)`), **nested fields**, **custom Rule classes**, and **Express/Fastify adapters**, use [`@eloquentjs/validator`](../validator/README.md):

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
    ValidateInput,           // class with handle(data, next) method
    SanitizeEmail,
    HashPassword,
    async (data, next) => next({ ...data, slug: slugify(data.name) }),
  )
  .thenReturn()
```

---

## Factories & Seeders

```js
import { Factory, Seeder } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'

class UserFactory extends Factory {
  model = User
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
const users = await UserFactory.new().count(50).create()

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
