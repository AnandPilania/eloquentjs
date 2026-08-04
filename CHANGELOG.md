# Changelog

## [0.0.7] — 2026-08-04

### 🐛 Bug Fixes

- dependencies conflict by peerDependency (`3938fd0`)


---

## [0.0.6] — 2026-08-04

### ✨ Features

- add typescript support (`e2c92bf`)


---

## [0.0.5] — 2026-07-31

### 🔧 Chores

- revamp (`a98efda`)


---

## [0.0.4] — 2026-06-27

### 🐛 Bug Fixes

- sql test (`a46563b`)
- #1 & #5; (`ee37e4d`)
- publish script (`d5beb86`)

### ✨ Features

- **model:** add model unguard (`436c7b7`)
- **sqlite:** add sqlite support (`960acb3`)


---

## [0.0.3] — 2026-04-07

### 🐛 Bug Fixes

- release script (`9c99f35`)

### 🔧 Chores

- revamp core (`7cc826b`)


---

All notable changes to EloquentJS are documented here.

This project follows [Semantic Versioning](https://semver.org/) and
[Conventional Commits](https://www.conventionalcommits.org/).

---

## [1.0.0] — 2025-03-15

### ✨ Features

- **codegen:** `introspect(ModelClass|descriptor)` — normalises any Model into a `ModelSchema` with per-field `gqlType`, `tsType`, `openApiType`; auto-detects relations, scopes, timestamps, softDeletes
- **codegen:** `introspectAll([...])` — batch introspection
- **codegen:** `generateGraphqlSDL` / `generateGraphqlSchema` — GraphQL SDL fragments and full standalone `.graphql` files
- **codegen:** `generateTypeScriptTypes` / `generateTypeScriptFile` — TypeScript interfaces + `CreateInput`, `UpdateInput`, `WhereInput`, `PaginationMeta`, `PaginatedResult<T>`
- **codegen:** `generateOpenApiSpec` — full OpenAPI 3.0 spec mirroring `@eloquentjs/api` routes with query params, soft-delete paths, error schemas
- **codegen:** `generateModelStub`, `generateMigrationStub`, `generateFactoryStub`, `generateSeederStub` — source stubs with faker hints and typed column generation from schema
- **codegen:** `loadModelsFromDir`, `loadModelsByName`, `renderGraphql`, `renderTypeScript`, `renderOpenApi`, `renderStubs` — render engine for file-based generation
- **graphql:** Refactored to use `@eloquentjs/codegen` internally for SDL generation
- **graphql:** New `buildSchemaFromDir(modelsDir, options)` — auto-loads all model files from a directory
- **cli:** `generate:graphql` — generates `schema.graphql` from live model files
- **cli:** `generate:types` — generates `models.d.ts` from live model files
- **cli:** `generate:openapi` — generates `openapi.json` or `openapi.yaml` from live model files
- **cli:** `make:model` and `make:migration` now delegate to codegen stubs when available, with inline fallback
- **core:** Base `Model` class with WeakMap/Proxy architecture for private state
- **core:** Full fluent `QueryBuilder` with 40+ where/order/join/aggregate methods
- **core:** `Collection` with 25+ functional methods (pluck, groupBy, chunk, mapInto, etc.)
- **core:** `CastRegistry` with built-in casts: boolean, integer, float, decimal, json, array, date, datetime
- **core:** Custom cast classes with `get`, `set`, `serialize` hooks
- **core:** `EventEmitter` — async global event bus with wildcard support
- **core:** `HookRegistry` — model lifecycle hooks and observer pattern
- **core:** `Schema` builder — create/alter/drop tables with a fluent column API
- **core:** `Validator` — rule-based validation with 15+ built-in rules
- **core:** `Pipeline` — composable data transformation pipes (class or function)
- **core:** `Factory` + `Seeder` — test data generation with state support
- **core:** `ConnectionRegistry` — named multi-connection management
- **core:** `RelationRegistry` — hasOne, hasMany, belongsTo, belongsToMany, hasManyThrough, morphTo, morphMany
- **core:** Soft deletes — `delete()`, `restore()`, `forceDelete()`, `withTrashed()`, `onlyTrashed()`
- **core:** Global and local query scopes with `withoutGlobalScope()`
- **core:** Accessors (`getXxxAttribute`) and Mutators (`setXxxAttribute`)
- **core:** Dirty checking — `isDirty()`, `getDirty()`, `getOriginal()`, `wasChanged()`
- **core:** `paginate()` — returns `{ data, meta: { total, per_page, current_page, last_page, has_more } }`
- **core:** `chunk()` — memory-efficient batch iteration
- **pgsql:** Full PostgreSQL driver with connection pooling via `pg`
- **pgsql:** Transaction support with automatic rollback on error
- **pgsql:** Complete SQL generation: SELECT, INSERT, UPDATE, DELETE, JOINs, GROUP BY, HAVING
- **pgsql:** Correct `$N` parameterized query numbering across WHERE, HAVING, LIMIT, OFFSET, UPDATE, INCREMENT
- **pgsql:** Schema builder mapped to PostgreSQL DDL
- **mongodb:** MongoDB driver using the official `mongodb` driver
- **mongodb:** ObjectId ↔ string `id` mapping
- **mongodb:** Support for nested document queries and array contains
- **realtime:** WebSocket server using `ws`, Pusher wire-protocol compatible
- **realtime:** `broadcastFrom(ModelClass)` — auto-broadcast model lifecycle events
- **realtime:** Public, private, and presence channels
- **realtime:** `RealtimeClient` — lightweight browser/Node client with auto-reconnect
- **realtime:** Channel auth handler for Express/Fastify
- **graphql:** `buildSchema([ModelClass, ...])` — auto-generates complete GraphQL SDL + resolvers
- **graphql:** Queries: `find`, `list` (paginated), `count`
- **graphql:** Mutations: `create`, `update`, `delete`, `upsert`, `restore`, `forceDelete`
- **graphql:** Subscriptions via async iterators over EventEmitter
- **graphql:** Relay and offset pagination modes
- **graphql:** Per-model `static graphql` config — hide fields, disable operations, middleware
- **graphql:** JSON and DateTime custom scalars
- **api:** `resource(ModelClass, opts)` + `apiRouter([...])` for Express
- **api:** `fastifyPlugin` for Fastify
- **api:** Auto-routes: index, show, store, update, patch, destroy, trashed, restore
- **api:** Nested resources, query filtering, search, sort, eager loading via `?with=`
- **api:** Policy-based authorization, response transformation, custom filters
- **api:** Automatic validation from `Model.rules`
- **cli:** `eloquent init` — scaffold config, directories, seeder, `.env.example`
- **cli:** `eloquent make:model` with `--migration`, `--factory`, `--seed`, `--all`, `--soft-deletes`
- **cli:** `eloquent make:migration` with smart template detection (create/add/drop/rename)
- **cli:** `eloquent make:seeder` and `eloquent make:factory`
- **cli:** `eloquent migrate` — run pending migrations, batch tracking via `_migrations` table
- **cli:** `eloquent migrate:rollback [--step=N]`, `migrate:reset`, `migrate:refresh`, `migrate:fresh`
- **cli:** `eloquent migrate:status` — color-coded migration status table
- **cli:** `eloquent db:seed [--class=SeederName]`
- **cli:** `eloquent db:wipe --force`
- **cli:** `eloquent list` — help with all commands

### ✅ Tests

- 523 unit tests across 10 suites, all passing
- Model, QueryBuilder, Collection, CastRegistry, Validator, Pipeline, EventEmitter, PgResolver, CLI, Codegen

### 🏗️  Build

- ESM-native monorepo with npm workspaces
- Unified versioning across all packages
- `scripts/release.js` — version bump, changelog generation, git tagging
- `scripts/publish.js` — ordered npm publish with dist-tag support
- `scripts/check-versions.js` — CI version consistency check
- GitHub Actions: CI (Node 18/20/22 matrix) + Release (publish on tag push)
