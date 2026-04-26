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

[![Tests](https://img.shields.io/badge/tests-735%20passing-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](#)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](#)

---

## Packages

| Package | Version | Description |
|---|---|---|
| [`@eloquentjs/core`](./packages/core) | ![npm](https://img.shields.io/npm/v/@eloquentjs/core) | Base Model, QueryBuilder, Relations, Events, Casts |
| [`@eloquentjs/codegen`](./packages/codegen) | ![npm](https://img.shields.io/npm/v/@eloquentjs/codegen) | Shared code generation — GraphQL SDL, TypeScript, OpenAPI, stubs |
| [`@eloquentjs/validator`](./packages/validator) | ![npm](https://img.shields.io/npm/v/@eloquentjs/validator) | Full validation — async rules, fluent schema API, unique/exists, adapters |
| [`@eloquentjs/pgsql`](./packages/pgsql) | ![npm](https://img.shields.io/npm/v/@eloquentjs/pgsql) | PostgreSQL driver (multi-connection, transactions) |
| [`@eloquentjs/sqlite`](./packages/sqlite) | ![npm](https://img.shields.io/npm/v/@eloquentjs/sqlite) | SQLite driver (local files, in-memory databases, migrations) |
| [`@eloquentjs/mongodb`](./packages/mongodb) | ![npm](https://img.shields.io/npm/v/@eloquentjs/mongodb) | MongoDB driver |
| [`@eloquentjs/realtime`](./packages/realtime) | ![npm](https://img.shields.io/npm/v/@eloquentjs/realtime) | WebSocket pub/sub — Pusher-protocol, auto-broadcast |
| [`@eloquentjs/graphql`](./packages/graphql) | ![npm](https://img.shields.io/npm/v/@eloquentjs/graphql) | Auto-generate GraphQL schema + resolvers |
| [`@eloquentjs/api`](./packages/api) | ![npm](https://img.shields.io/npm/v/@eloquentjs/api) | One-line REST CRUD routes (Express + Fastify) |
| [`@eloquentjs/mcp`](./packages/mcp) | ![npm](https://img.shields.io/npm/v/@eloquentjs/mcp) | MCP server — 21 tools for AI agents (Claude, Cursor, Windsurf) |
| [`@eloquentjs/cli`](./packages/cli) | ![npm](https://img.shields.io/npm/v/@eloquentjs/cli) | CLI — scaffold, migrate, seed, generate |

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
await User.active().admins().latest().first()
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

// BelongsToMany pivot
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().sync([1, 2, 3])

// Polymorphic
class Comment extends Model {
  commentable() { return this.morphTo('commentable') }
}
```

### Events & Observers

```js
class UserObserver {
  creating(user) { user.uuid = crypto.randomUUID() }
  created(user)  { WelcomeEmail.send(user) }
  deleting(user) { user.posts().delete() }
}
HookRegistry.observe(User, new UserObserver())
```

### Realtime

```js
import { createRealtimeServer } from '@eloquentjs/realtime'
const rt = createRealtimeServer({ port: 6001 })
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

| File | For |
|---|---|
| `CLAUDE.md` | Claude.ai — drop in project root, auto-loaded |
| `GEMINI.md` | Gemini-based tools |
| `.cursorrules` | Cursor — drop in project root |
| `.windsurfrules` | Windsurf — drop in project root |
| `copilot-instructions.md` | GitHub Copilot — copy to `.github/copilot-instructions.md` |
| `skills/db-skill.md` | Deep DB patterns for any agent |
| `skills/api-skill.md` | REST API patterns |
| `skills/mcp-skill.md` | MCP tool reference and setup |

---

## Repository Structure

```
eloquentjs/
├── packages/
│   ├── core/          @eloquentjs/core
│   ├── codegen/       @eloquentjs/codegen
│   ├── validator/     @eloquentjs/validator
│   ├── pgsql/         @eloquentjs/pgsql
│   ├── mongodb/       @eloquentjs/mongodb
│   ├── realtime/      @eloquentjs/realtime
│   ├── graphql/       @eloquentjs/graphql
│   ├── api/           @eloquentjs/api
│   ├── mcp/           @eloquentjs/mcp
│   └── cli/           @eloquentjs/cli
├── tests/
│   └── unit/          700 tests, 12 suites, all passing
├── agent-files/       CLAUDE.md, .cursorrules, skills/...
├── .github/
│   └── workflows/     CI + Release automation
├── scripts/
│   ├── release.js     Version bump + changelog
│   ├── publish.js     npm publish orchestration
│   └── check-versions.js  Version consistency check
└── CHANGELOG.md
```

---

## Development

```bash
git clone https://github.com/your-org/eloquentjs.git
cd eloquentjs && npm install

npm test                                           # run all 700 tests
npm run test:coverage                              # with coverage report
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
npm run publish:all      # publish all 10 packages to npm
```

---

## Contributing

1. Fork → branch: `git checkout -b feat/my-feature`
2. Write tests: `npm test`
3. Commit via [Conventional Commits](https://conventionalcommits.org): `feat(core): add X`
4. Open a Pull Request

---

## License

MIT © EloquentJS Contributors
