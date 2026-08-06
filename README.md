# EloquentJS

> Laravel Eloquent for Node.js — modular, extensible, batteries-included.

```js
// Reads like English.
const users = await User
  .where('active', true)
  .where('age', '>', 18)
  .with('posts', 'profile')
  .orderBy('name')
  .paginate(1, 20)
```

[![Tests](https://img.shields.io/badge/tests-1146%20passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.6.0-brightgreen)](#)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](#)

---

## Packages

| Package                                         | Version                                                    | Description                                                               |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`@eloquentjs/core`](./packages/core)           | ![npm](https://img.shields.io/npm/v/@eloquentjs/core)      | Base Model, QueryBuilder, Relations, Events, Casts                        |
| [`@eloquentjs/codegen`](./packages/codegen)     | ![npm](https://img.shields.io/npm/v/@eloquentjs/codegen)   | Shared code generation — GraphQL SDL, TypeScript, OpenAPI, stubs          |
| [`@eloquentjs/validator`](./packages/validator) | ![npm](https://img.shields.io/npm/v/@eloquentjs/validator) | Full validation — async rules, fluent schema API, unique/exists, adapters |
| [`@eloquentjs/pgsql`](./packages/pgsql)         | ![npm](https://img.shields.io/npm/v/@eloquentjs/pgsql)     | PostgreSQL driver (multi-connection, transactions)                        |
| [`@eloquentjs/sqlite`](./packages/sqlite)       | ![npm](https://img.shields.io/npm/v/@eloquentjs/sqlite)    | SQLite driver (better-sqlite3, file or in-memory)                         |
| [`@eloquentjs/mongodb`](./packages/mongodb)     | ![npm](https://img.shields.io/npm/v/@eloquentjs/mongodb)   | MongoDB driver                                                            |
| [`@eloquentjs/realtime`](./packages/realtime)   | ![npm](https://img.shields.io/npm/v/@eloquentjs/realtime)  | WebSocket pub/sub — Pusher-protocol, auto-broadcast                       |
| [`@eloquentjs/graphql`](./packages/graphql)     | ![npm](https://img.shields.io/npm/v/@eloquentjs/graphql)   | Auto-generate GraphQL schema + resolvers                                  |
| [`@eloquentjs/api`](./packages/api)             | ![npm](https://img.shields.io/npm/v/@eloquentjs/api)       | One-line REST CRUD routes (Express + Fastify)                             |
| [`@eloquentjs/mcp`](./packages/mcp)             | ![npm](https://img.shields.io/npm/v/@eloquentjs/mcp)       | MCP server — 21 tools for AI agents (Claude, Cursor, Windsurf)            |
| [`@eloquentjs/cli`](./packages/cli)             | ![npm](https://img.shields.io/npm/v/@eloquentjs/cli)       | CLI — scaffold, migrate, seed, generate                                   |

---

## Quick Start

```bash
npm install @eloquentjs/core @eloquentjs/pgsql
# Or: npm install @eloquentjs/core @eloquentjs/sqlite
npm install -g @eloquentjs/cli

# Initialize in your project
eloquent init

# Scaffold a model with everything
eloquent make:model User --all

# Run migrations
eloquent migrate

# Generate GraphQL schema, TypeScript types, and OpenAPI spec
npm install @eloquentjs/codegen
eloquent generate:graphql
eloquent generate:types
eloquent generate:openapi

# Add MCP server for AI agents (Claude.ai, Cursor, Windsurf)
npm install -g @eloquentjs/mcp
eloquent-mcp --cwd .
```

---

## Feature Highlights

### Model & Query Builder

```js
import { Model } from '@eloquentjs/core'

class User extends Model {
  static table       = 'users'
  static fillable    = ['name', 'email', 'password']
  static hidden      = ['password']
  static softDeletes = true
  static casts       = { is_admin: 'boolean', settings: 'json', created_at: 'date' }

  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role, 'user_roles') }

  getFullNameAttribute()  { return `${this.first_name} ${this.last_name}` }
  setPasswordAttribute(v) { return bcrypt.hashSync(v, 10) }

  static scopeActive(qb)   { return qb.where('active', true) }
  static async creating(u) { u.slug = slugify(u.name) }
}

await User.where('active', true).with('posts').orderBy('name').paginate(1, 20)
await User.whereIn('role', ['admin', 'editor']).get()
await User.whereBetween('age', [18, 65]).count()
await User.scope('active').latest().first()

// Relationship queries
await User.whereHas('posts', qb => qb.where('published', true)).get()
const users = await User.withCount('posts').get()   // users[0].posts_count

// Transactions — model writes inside participate, on every driver
import { DB } from '@eloquentjs/core'
await DB.transaction(async () => {
  const user = await User.create({ name: 'Alice' })
  await user.profile().create({ bio: 'Hello' })
})   // a throw here rolls all of it back

// Global mass-assignment bypass
Model.unguard()
await User.create({ id: 99, name: 'Seed User', email: 'seed@example.com' })
Model.reguard()

// Or use the scoped helper to restore automatically
await Model.unguarded(async () => {
  await User.create({ id: 99, name: 'Seed User', email: 'seed@example.com' })
})
```

### Validation

```js
import { v, Rule } from '@eloquentjs/validator'

const schema = v.schema({
  name:     v.string().min(2).max(100),
  email:    v.string().email().unique('users', 'email'),  // async DB check
  password: v.string().min(8).confirmed(),
  age:      v.number().integer().min(18).optional(),
  role:     v.string().oneOf(['admin', 'editor', 'viewer']),
  address:  v.object({ city: v.string(), zip: v.string().digits(5) }),
})

const data = await schema.parseAsync(req.body)   // throws ValidationException on failure
const { success, errors } = await schema.safeParseAsync(req.body)  // never throws

// Express middleware
import { expressValidate } from '@eloquentjs/validator/adapters'
router.post('/users', expressValidate(schema, { async: true }), handler)
// req.validated contains only schema-defined fields
```

### Relations

```js
// Eager load — prevents N+1
await User.with('posts.comments.author').get()
await User.with({ posts: qb => qb.where('published', true) }).get()

// A relation is a query builder — every method constrains the DB query
await user.posts().where('published', true).latest().limit(5).get()
await user.posts().paginate(1, 20)

// BelongsToMany pivot
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().sync([1, 2, 3])
const roles = await user.roles().withPivot('assigned_at').get()
roles[0].pivot.assigned_at

// Polymorphic — register aliases so a class rename can't orphan existing rows
import { ModelRegistry } from '@eloquentjs/core'
ModelRegistry.morphMap({ post: Post, video: Video })

class Comment extends Model {
  commentable() { return this.morphTo('commentable') }
}
```

### Events & Observers

```js
class UserObserver {
  retrieved(user) { }
  saving(user)    { }                                   // insert and update
  creating(user)  { user.uuid = crypto.randomUUID() }
  created(user)   { WelcomeEmail.send(user) }
  updating(user)  { if (user.locked) return false }     // false cancels the save
  deleting(user)  { user.posts().delete() }
}
User.observe(new UserObserver())

// Or a single hook; the return value unregisters it
const off = User.on('created', user => audit(user))
```

Registration is keyed on the class reference, so two `User` classes from
different modules don't collide and a minifier can't break it.

### Realtime

```js
import { createRealtimeServer } from '@eloquentjs/realtime'

// appKey/appSecret are required — private and presence channels are signed
// with the secret, and a subscribe without a valid signature is rejected.
const rt = createRealtimeServer({
  port:      6001,
  appKey:    process.env.ELOQUENT_APP_KEY,
  appSecret: process.env.ELOQUENT_APP_SECRET,
})
rt.broadcastFrom(User)   // broadcasts User:created/updated/deleted
```

### GraphQL

```js
import { buildSchema, buildSchemaFromDir } from '@eloquentjs/graphql'

const { typeDefs, resolvers } = buildSchema([User, Post, Comment], {
  subscriptions: true,
  auth: async (ctx) => authenticateFromToken(ctx.req.headers.authorization),
})

// Or auto-load all models from a directory
const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models')

// CLI generation
eloquent generate:graphql --out=schema.graphql
eloquent generate:graphql --pagination=relay
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
    filterable:  ['role', 'active'],        // opt-in: ?role=admin&active=1
    policy:      async (req, model, action) => action === 'destroy' ? req.user.is_admin : true,
  }),
  resource(Post, { only: ['index', 'show', 'store'] }),
]))
// GET /api/users?page=1&search=alice&sort=-created_at&with=profile
```

### MCP Server for AI Agents

```js
// Start the MCP server — AI agents get 21 tools to work with your models
eloquent-mcp --cwd /path/to/project

// Tools available to the agent:
// list_models, describe_model, describe_database_schema
// generate_model, generate_migration, generate_graphql_schema
// query_model, run_migrations, migration_status
// get_help, get_method_signature, get_examples
// nlp_query, nlp_crud, ... (21 total)
```

Configure in your AI tool — see [`@eloquentjs/mcp`](./packages/mcp/README.md) for setup instructions for Claude.ai, Cursor, and Windsurf.

---

## AI Agent Files

The `agent-files/` directory contains ready-to-use files for AI coding assistants:

| File                      | For                                                        |
| ------------------------- | ---------------------------------------------------------- |
| `CLAUDE.md`               | Claude.ai — drop in project root, auto-loaded              |
| `GEMINI.md`               | Gemini-based tools                                         |
| `.cursorrules`            | Cursor — drop in project root                              |
| `.windsurfrules`          | Windsurf — drop in project root                            |
| `copilot-instructions.md` | GitHub Copilot — copy to `.github/copilot-instructions.md` |
| `skills/db-skill.md`      | Deep DB patterns for any agent                             |
| `skills/api-skill.md`     | REST API patterns                                          |
| `skills/mcp-skill.md`     | MCP tool reference and setup                               |

---

## Repository Structure

```
eloquentjs/
├── packages/
│   ├── core/          @eloquentjs/core
│   ├── codegen/       @eloquentjs/codegen
│   ├── validator/     @eloquentjs/validator
│   ├── pgsql/         @eloquentjs/pgsql
│   ├── sqlite/        @eloquentjs/sqlite
│   ├── mongodb/       @eloquentjs/mongodb
│   ├── realtime/      @eloquentjs/realtime
│   ├── graphql/       @eloquentjs/graphql
│   ├── api/           @eloquentjs/api
│   ├── mcp/           @eloquentjs/mcp
│   └── cli/           @eloquentjs/cli
├── tests/
│   └── unit/          1146 tests, 22 suites, all passing
├── agent-files/       CLAUDE.md, .cursorrules, skills/...
├── .github/
│   └── workflows/     CI + Release automation
├── scripts/
│   ├── release.js     Version bump + changelog
│   ├── publish.js     npm publish orchestration
│   ├── lint.js        Parse check (node --check), run after ESLint
│   └── check-versions.js  Version consistency check
└── CHANGELOG.md
```

---

## Development

```bash
git clone https://github.com/your-org/eloquentjs.git
cd eloquentjs && npm install

npm test                                           # run all 1146 tests
npm run lint                                       # ESLint, then a per-file parse check
npm run lint:fix                                   # auto-fix what ESLint can
npm run typecheck                                  # tsc: JSDoc -> .d.ts, fails on type errors
npm run check                                      # lint + typecheck + tests
npm run test:coverage                              # coverage, with a floor CI enforces
npm test -- --testPathPattern=MCP                  # single suite
npm run check:versions                             # verify all packages at same version
```

---

## Releasing

All packages share one version number. Full process in [RELEASING.md](./RELEASING.md).

```bash
npm run release:patch    # 1.0.0 → 1.0.1
npm run release:minor    # 1.0.0 → 1.1.0
npm run release:major    # 1.0.0 → 2.0.0
npm run release:alpha    # 1.0.0 → 1.0.1-alpha.0
npm run release:beta     # 1.0.0 → 1.0.1-beta.0
npm run release:rc       # 1.0.0 → 1.0.1-rc.0
npm run release:next     # 1.0.0 → 1.0.1-next.0
npm run check:versions   # verify all 12 manifests agree
npm run publish:all      # publish all 11 packages to npm
```

---

## Writing a driver

`@eloquentjs/core` never writes SQL — it builds a neutral context object and
hands it to a **resolver**. Implement that one interface and Model, QueryBuilder,
relations, Schema, factories and seeders all work unchanged.

- **[The Resolver Contract](./packages/core/RESOLVER.md)** — the interface, the
  query-context shape, every where type, and the dialect traps (OR precedence,
  nested groups, column defaults).
- **Conformance suite** — `@eloquentjs/core/testing` exports `describeResolverShape`
  (no database; checks the interface is complete) and `describeResolverBehavior`
  (needs a live database; checks it behaves). See
  [tests/unit/ResolverConformance.test.js](./tests/unit/ResolverConformance.test.js)
  for all three in-tree drivers wired up.

```js
import { describeResolverShape, describeResolverBehavior } from '@eloquentjs/core/testing'

describeResolverShape('MyResolver', () => new MyResolver(fakeConnection()))
describeResolverBehavior('MyResolver', { makeResolver, createTable })
```

---

## Contributing

1. Fork → branch: `git checkout -b feat/my-feature`
2. Write tests: `npm test`
3. Commit via [Conventional Commits](https://conventionalcommits.org): `feat(core): add X`
4. Open a Pull Request

---

## License

MIT © EloquentJS Contributors — see [LICENSE](./LICENSE)
