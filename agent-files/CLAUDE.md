# EloquentJS Project

This project uses **EloquentJS** — a Laravel Eloquent-inspired ORM for Node.js.

## Package Overview

| Package | Purpose |
|---|---|
| `@eloquentjs/core` | Model, QueryBuilder, Relations, Events, Casts, Schema |
| `@eloquentjs/pgsql` | PostgreSQL driver |
| `@eloquentjs/mongodb` | MongoDB driver |
| `@eloquentjs/validator` | Validation (sync + async, fluent schema API) |
| `@eloquentjs/graphql` | Auto-generate GraphQL schema + resolvers |
| `@eloquentjs/api` | Auto-CRUD REST routes for Express/Fastify |
| `@eloquentjs/realtime` | WebSocket pub/sub (Pusher-protocol) |
| `@eloquentjs/codegen` | Code generation engine (GraphQL SDL, TypeScript, OpenAPI) |
| `@eloquentjs/cli` | CLI — scaffold, migrate, seed, generate |
| `@eloquentjs/mcp` | MCP server for AI agents |

## MCP Tools Available

If `@eloquentjs/mcp` is running, use these tools before writing code:

- **`list_models`** — see all models, their fields, relations, and casts
- **`describe_model`** — deep introspection of one model
- **`describe_database_schema`** — live table/column/index info from DB
- **`get_help`** — docs for any topic (model, query-builder, relations, validation, etc.)
- **`get_method_signature`** — exact method signature + return type
- **`get_examples`** — copy-paste code for common patterns
- **`nlp_query`** — translate natural language to QueryBuilder
- **`generate_model`** — scaffold a model (+ migration/factory/seeder)
- **`run_migrations`** / **`migration_status`** — manage schema changes
- **`query_model`** — safe SELECT queries against live data

## Key Patterns

### Models

```js
// Always use static properties for config
class User extends Model {
  static table    = 'users'
  static fillable = ['name', 'email']    // what create/update can set
  static hidden   = ['password']         // excluded from toJSON()
  static casts    = { is_admin: 'boolean', settings: 'json' }
  static softDeletes = true              // adds deleted_at support

  posts() { return this.hasMany(Post) }
  static scopeActive(qb) { return qb.where('active', true) }
}
```

### Queries

```js
// All queries are awaitable QueryBuilder chains
await User.where('active', true).with('posts').orderBy('name').paginate(1, 20)
await User.whereIn('role', ['admin', 'editor']).count()
await User.whereRaw('age > ?', [18]).first()
```

### Relationships

```js
// Eager loading prevents N+1 queries
await User.with('posts', 'profile').get()
await User.with('posts.comments.author').get()  // nested
await User.with({ posts: qb => qb.where('published', true) }).get()  // constrained

// BelongsToMany
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().sync([1, 2, 3])
```

### Validation

```js
import { v, Validator } from '@eloquentjs/validator'

// Fluent schema API
const schema = v.schema({
  name:  v.string().min(2).max(100),
  email: v.string().email(),
  age:   v.number().integer().min(18).optional(),
})
const data = schema.parse(req.body)          // throws ValidationException
const { success, errors } = schema.safeParse(req.body)  // never throws

// Async with DB check
const schema = v.schema({
  email: v.string().email().unique('users', 'email'),
})
const data = await schema.parseAsync(req.body)
```

### REST API

```js
import { apiRouter, resource } from '@eloquentjs/api'

app.use('/api', apiRouter([
  resource(User, {
    middleware:  [authRequired],
    with:        ['profile'],
    searchable:  ['name', 'email'],
    sortable:    ['name', 'created_at'],
    policy: async (req, model, action) =>
      action === 'destroy' ? req.user.is_admin : true,
  }),
]))
// Generates: GET/POST /api/users, GET/PUT/PATCH/DELETE /api/users/:id
```

### GraphQL

```js
import { buildSchema } from '@eloquentjs/graphql'

// From model classes
const { typeDefs, resolvers } = buildSchema([User, Post], { subscriptions: true })

// From directory (auto-loads all .js model files)
const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models')

// CLI generation
// eloquent generate:graphql --out=schema.graphql
```

### Migrations

```js
// CLI commands
// eloquent make:migration create_posts_table   → smart template
// eloquent migrate                              → run pending
// eloquent migrate:rollback                     → undo last batch
// eloquent migrate:fresh --seed                 → drop all + re-run + seed
// eloquent migrate:status                       → see what's run
```

### Soft Deletes

```js
class Post extends Model { static softDeletes = true }

await post.delete()            // sets deleted_at, NOT removed from DB
await post.restore()           // clears deleted_at
await post.forceDelete()       // permanent
await Post.withTrashed().get() // includes deleted
await Post.onlyTrashed().get() // only deleted
```

### Transactions

```js
import { transaction } from '@eloquentjs/pgsql'
await transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.roles().attach(adminRoleId)
  // Any throw → automatic ROLLBACK
})
```

## CLI Quick Reference

```bash
eloquent init                          # scaffold config, directories
eloquent make:model User --all         # model + migration + factory + seeder
eloquent make:migration create_posts   # migration with smart template
eloquent migrate                       # run pending migrations
eloquent db:seed                       # run DatabaseSeeder
eloquent generate:graphql              # schema.graphql from models
eloquent generate:types                # TypeScript types from models
eloquent generate:openapi              # OpenAPI 3.0 spec from models
```

## Coding Conventions

- Models go in `app/models/`, named `PascalCase.js` with default export
- Migrations go in `database/migrations/`, named `YYYYMMDDHHMMSS_description.js`
- Factories go in `database/factories/`, seeders in `database/seeders/`
- All DB operations are async — always `await`
- Use `findOrFail()` when the record must exist (auto-throws 404-ready error)
- Use `with()` for all relations that will be used (never load relations in loops)
- Validate all user input with `@eloquentjs/validator` before passing to `create()`/`update()`

## Error Handling

```js
import { ModelNotFoundException, ValidationException } from '@eloquentjs/core'

// These are thrown by the ORM automatically:
// ModelNotFoundException  → findOrFail(), firstOrFail()
// ValidationException     → Validator.validated(), schema.parse()
// MassAssignmentException → setting a guarded field

try {
  const user = await User.findOrFail(id)
} catch (err) {
  if (err.name === 'ModelNotFoundException') res.status(404).json({ error: err.message })
}
```
