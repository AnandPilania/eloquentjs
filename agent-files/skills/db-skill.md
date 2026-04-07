# EloquentJS DB Skill

## When to use this skill
Use when writing database queries, defining models, setting up relations, or managing transactions with EloquentJS.

---

## Model Setup Checklist

Every model needs:
1. `static table` — the DB table name
2. `static fillable` — fields allowed in `create()`/`update()`  
3. `static casts` — type conversions
4. Relations defined as instance methods

```js
import { Model } from '@eloquentjs/core'

export default class User extends Model {
  static table       = 'users'
  static primaryKey  = 'id'
  static fillable    = ['name', 'email', 'password', 'role_id']
  static hidden      = ['password', 'remember_token']
  static softDeletes = true
  static casts = {
    is_admin:    'boolean',
    score:       'integer',
    balance:     'decimal:2',
    preferences: 'json',
    tags:        'array',
    born_at:     'date',
    created_at:  'datetime',
  }

  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role, 'user_roles') }
}
```

---

## Querying Patterns

### Read operations
```js
// All records (avoid in production without limit)
const users = await User.all()

// Find by ID
const user = await User.find(1)           // null if not found
const user = await User.findOrFail(1)     // throws if not found

// First matching record
const user = await User.where('email', 'a@b.com').first()
const user = await User.where('email', 'a@b.com').firstOrFail()

// With conditions
const users = await User.where('active', true)
  .where('age', '>', 18)
  .whereNotNull('email_verified_at')
  .orderByDesc('created_at')
  .limit(50)
  .get()

// Paginated (always use for list endpoints)
const page = await User.where('active', true)
  .with('profile')
  .orderBy('name')
  .paginate(req.query.page ?? 1, 20)
// Returns: { data: User[], meta: { total, per_page, current_page, last_page, has_more } }
```

### Write operations
```js
// Create
const user = await User.create({ name: 'Alice', email: 'a@b.com' })

// Update
await user.update({ name: 'Alicia' })
user.name = 'Alicia'
await user.save()

// Upsert
await User.updateOrCreate({ email: 'a@b.com' }, { name: 'Alice' })
await User.firstOrCreate({ email: 'a@b.com' }, { name: 'Alice' })

// Mass update
await User.where('active', false).update({ notified: true })

// Delete (soft if enabled, otherwise hard)
await user.delete()
await user.forceDelete()   // always hard delete
await user.restore()       // undo soft delete

// Increment/Decrement
await Post.where('id', postId).increment('view_count')
await User.where('id', userId).decrement('credits', 10)
```

---

## Relations — Complete Reference

### One-to-One
```js
class User extends Model {
  profile() { return this.hasOne(Profile, 'user_id') }
}
class Profile extends Model {
  user() { return this.belongsTo(User, 'user_id') }
}
```

### One-to-Many
```js
class Post extends Model {
  comments() { return this.hasMany(Comment, 'post_id') }
  user()      { return this.belongsTo(User, 'user_id') }
}
```

### Many-to-Many
```js
class User extends Model {
  roles() { return this.belongsToMany(Role, 'user_roles', 'user_id', 'role_id') }
}

// Pivot operations
await user.roles().attach(roleId)
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().detach(roleId)
await user.roles().sync([1, 2, 3])         // replaces all
await user.roles().toggle(roleId)           // attach if not, detach if is
const roles = await user.roles()
console.log(roles[0]._pivot.assigned_at)   // pivot data
```

### Polymorphic
```js
class Image extends Model {
  imageable() { return this.morphTo('imageable') }
}
class User extends Model {
  images() { return this.morphMany(Image, 'imageable') }
}
class Post extends Model {
  images() { return this.morphMany(Image, 'imageable') }
}
```

### Has-Many-Through
```js
class Country extends Model {
  posts() { return this.hasManyThrough(Post, User, 'country_id', 'user_id') }
}
```

---

## Preventing N+1 Queries

**Always** use `.with()` when you'll access relations after fetching.

```js
// ❌ N+1: 1 query for posts + 1 per post for user
const posts = await Post.all()
for (const post of posts) {
  console.log(await post.user())  // each one hits DB
}

// ✅ 2 queries total regardless of count
const posts = await Post.with('user').all()
for (const post of posts) {
  console.log(post.user)  // already loaded
}

// ✅ Nested eager loading
const posts = await Post.with('user', 'comments.author', 'tags').get()

// ✅ Constrained eager loading
const users = await User.with({
  posts: qb => qb.where('published', true).orderByDesc('created_at').limit(5),
}).get()
```

---

## Transactions

```js
import { transaction } from '@eloquentjs/pgsql'

// All operations use same DB connection, automatic ROLLBACK on throw
await transaction(async () => {
  const order = await Order.create({ user_id: userId, total: 99.99 })
  await OrderItem.create({ order_id: order.id, product_id: productId })
  await Product.where('id', productId).decrement('stock')
  await User.where('id', userId).decrement('credits', 99.99)
  // If any line throws, ALL changes are rolled back
})
```

---

## Soft Deletes

```js
class Post extends Model { static softDeletes = true }

// Normal queries auto-exclude soft-deleted rows
await Post.all()               // excludes deleted_at IS NOT NULL

// Include deleted
await Post.withTrashed().get()
await Post.withTrashed().find(id)  // even if deleted

// Only deleted
await Post.onlyTrashed().get()

// Restore
const post = await Post.onlyTrashed().findOrFail(id)
await post.restore()

// Check state
post.trashed()  // true if soft-deleted
```

---

## Aggregates and Raw

```js
await User.count()
await User.where('active', true).count()
await Product.max('price')
await Product.min('price')
await Order.sum('total')
await Product.avg('price')
await User.exists()
await User.doesntExist()

// Raw where
await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).first()
await User.selectRaw('DATE(created_at) as date, COUNT(*) as count')
  .groupByRaw('DATE(created_at)')
  .get()
```

---

## Multiple Connections

```js
import { connect } from '@eloquentjs/pgsql'
import { connect as mongoConnect } from '@eloquentjs/mongodb'

const primary  = await connect({ url: process.env.DATABASE_URL }, 'primary')
const replica  = await connect({ url: process.env.REPLICA_URL  }, 'replica')
const analytics = await mongoConnect({ url: process.env.MONGO_URL }, 'analytics')

class AnalyticsEvent extends Model {
  static connection = 'analytics'  // uses MongoDB
}

class ReadHeavyReport extends Model {
  static connection = 'replica'   // uses read replica
}
```
