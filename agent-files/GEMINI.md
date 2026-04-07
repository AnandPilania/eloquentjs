# EloquentJS — Gemini Agent Instructions

This project uses **EloquentJS**, a full-featured ORM and backend framework for Node.js.

## Architecture

```
@eloquentjs/core       ← Model, QueryBuilder, Relations, Events, Casts (zero-dep)
@eloquentjs/codegen    ← Code generation engine (used by graphql + cli)
@eloquentjs/validator  ← Validation: sync/async rules, fluent schema, unique/exists
@eloquentjs/pgsql      ← PostgreSQL driver (pg pool, transactions, schema builder)
@eloquentjs/mongodb    ← MongoDB driver
@eloquentjs/graphql    ← Auto GraphQL schema + resolvers from models
@eloquentjs/api        ← One-line CRUD REST routes (Express + Fastify)
@eloquentjs/realtime   ← WebSocket pub/sub, Pusher-protocol
@eloquentjs/cli        ← scaffold, migrate, seed, generate commands
@eloquentjs/mcp        ← MCP server — exposes tools to AI agents
```

## Model Definition Reference

```js
import { Model } from '@eloquentjs/core'

export default class Post extends Model {
  // Required: table name (or auto-derived as snake_plural of class name)
  static table = 'posts'

  // Mass assignment protection
  static fillable = ['title', 'body', 'user_id', 'status']
  static guarded  = ['id']  // always guarded; override fillable OR guarded, not both

  // Serialization
  static hidden  = ['internal_hash']  // excluded from toJSON()
  static appends = ['url']            // virtual attrs always included in toJSON()

  // Type casting on read/write
  static casts = {
    title:      'string',
    body:       'text',
    is_public:  'boolean',
    views:      'integer',
    price:      'decimal:2',
    tags:       'array',     // JSON array
    meta:       'json',      // JSON object
    born_at:    'date',      // Date object
    updated_at: 'datetime',  // Date + time
  }

  // Soft deletes (sets deleted_at instead of removing row)
  static softDeletes = true

  // Timestamps (true by default — adds created_at, updated_at)
  static timestamps = true

  // Which DB connection to use (default: 'default')
  static connection = 'default'

  // ── Relations ──────────────────────────────────────────────────────────────
  user()     { return this.belongsTo(User) }          // Post belongs to User
  comments() { return this.hasMany(Comment) }          // Post has many Comments
  tags()     { return this.belongsToMany(Tag, 'post_tags') }  // M2M via post_tags
  image()    { return this.morphOne(Image, 'imageable') }      // polymorphic

  // ── Accessors (computed properties) ───────────────────────────────────────
  getUrlAttribute() {
    return `/posts/${this.id}`
  }

  // ── Mutators (transform on set) ────────────────────────────────────────────
  setTitleAttribute(val) {
    return val.trim()
  }

  // ── Local scopes ───────────────────────────────────────────────────────────
  static scopePublished(qb)   { return qb.where('status', 'published') }
  static scopeByTag(qb, slug) { return qb.join('post_tags', ...).where('tags.slug', slug) }

  // ── Lifecycle hooks (all async, all awaited) ───────────────────────────────
  static async creating(post) { post.slug = slugify(post.title) }
  static async created(post)  { await notifySubscribers(post) }
  static async deleting(post) { await post.comments().delete() }
}
```

## QueryBuilder Complete API

```js
// Fetching
Model.all()
Model.find(id)
Model.findOrFail(id)       // throws ModelNotFoundException
Model.findMany([1,2,3])
Model.first()
Model.firstOrFail()
Model.firstOrCreate({ email }, { name })
Model.updateOrCreate({ email }, { name })

// WHERE
.where(field, value)              // WHERE field = value
.where(field, operator, value)    // WHERE field operator value
.where({ field1: v1, field2: v2}) // multiple AND conditions
.whereNot(field, value)
.whereIn(field, [values])
.whereNotIn(field, [values])
.whereNull(field)
.whereNotNull(field)
.whereBetween(field, [lo, hi])
.whereNotBetween(field, [lo, hi])
.whereLike(field, '%pattern%')
.whereDate(field, date)
.whereYear(field, year)
.whereMonth(field, month)
.whereJsonContains(field, value)
.whereRaw('SQL ?', [params])
.orWhere(field, value)
.where(qb => qb.where(...).orWhere(...))  // grouped conditions

// ORDER / LIMIT
.orderBy(field, 'asc'|'desc')
.orderByDesc(field)
.latest()           // orderBy created_at desc
.oldest()           // orderBy created_at asc
.inRandomOrder()
.limit(n)
.offset(n)
.take(n) .skip(n)   // aliases
.forPage(page, perPage)

// SELECT
.select('id', 'name', 'email')
.addSelect('role')
.distinct()

// JOINS
.join(table, col1, '=', col2)
.leftJoin(table, col1, '=', col2)

// AGGREGATES
.count()
.max(field)
.min(field)
.sum(field)
.avg(field)
.exists()
.doesntExist()

// EAGER LOADING
.with('posts', 'profile')
.with('posts.comments')
.with({ posts: qb => qb.where('published', true) })

// RESULTS
.get()           // → Collection
.first()         // → Model|null
.paginate(page, perPage)  // → { data, meta }
.chunk(size, callback)    // memory-efficient iteration
.pluck(field)    // → array of values
.value(field)    // → single value

// MUTATIONS (via query)
.update({ field: value })
.delete()
.increment(field, amount?)
.decrement(field, amount?)
```

## Validation Quick Reference

```js
import { v, Validator, Rule } from '@eloquentjs/validator'
import { required, email, min, max, unique } from '@eloquentjs/validator/rules'
import { expressValidate } from '@eloquentjs/validator/adapters'

// Fluent schema (recommended)
const userSchema = v.schema({
  name:     v.string().min(2).max(100),
  email:    v.string().email(),
  password: v.string().min(8).confirmed(),
  role:     v.string().oneOf(['admin', 'editor']),
  age:      v.number().integer().min(18).optional(),
  dob:      v.date().before('2010-01-01').optional(),
  tags:     v.array().min(1).max(10),
  address:  v.object({ city: v.string(), zip: v.string().digits(5) }),
})

// Express middleware
router.post('/users', expressValidate(userSchema, { async: true }), handler)
// req.validated contains only the schema-defined fields

// Custom async rule
class SlugUnique extends Rule {
  message() { return 'This slug is already taken.' }
  async passesAsync(field, value) {
    return !(await Post.where('slug', value).exists())
  }
}
```

## Generating Code

```bash
# Models
eloquent make:model Post --all              # model + migration + factory + seeder
eloquent make:model Post --soft-deletes     # with deleted_at support

# Migrations  
eloquent make:migration create_posts_table  # CREATE TABLE template
eloquent make:migration add_views_to_posts  # ALTER TABLE template
eloquent make:migration drop_old_tags       # DROP TABLE template

# Schema files (from existing models)
eloquent generate:graphql                   # → schema.graphql
eloquent generate:types                     # → models.d.ts  
eloquent generate:openapi                   # → openapi.json

# Database
eloquent migrate                            # run pending
eloquent migrate:fresh --seed               # dev reset
eloquent db:seed --class=UserSeeder         # specific seeder
```

## Common Mistakes to Avoid

1. **N+1 queries** — always use `.with()` when accessing relations in a loop
   ```js
   // ❌ N+1
   const posts = await Post.all()
   for (const p of posts) { await p.user() }  // 1 query per post

   // ✅ Eager load
   const posts = await Post.with('user').all()
   ```

2. **Not awaiting** — all DB calls return Promises
   ```js
   // ❌ Missing await
   const user = User.find(1)  // user is a Promise, not a User

   // ✅
   const user = await User.find(1)
   ```

3. **Unfillable fields** — always declare `fillable` or `guarded`
   ```js
   // ❌ Silently ignores all fields if fillable is empty []
   await User.create({ name: 'Alice' })  // name is ignored!

   // ✅
   class User extends Model { static fillable = ['name', 'email'] }
   ```

4. **Sync validation for async rules** — `unique`/`exists` need `validateAsync()`
   ```js
   // ❌ unique rule silently skipped in sync mode
   validator.validates()

   // ✅
   await validator.validateAsync()
   ```
