# @eloquentjs/codegen

> Shared code generation engine for EloquentJS. Introspects Model classes and generates GraphQL SDL, TypeScript types, OpenAPI specs, and source stubs. Used internally by `@eloquentjs/graphql` and `@eloquentjs/cli`.

```bash
npm install @eloquentjs/codegen
```

---

## What It Does

`@eloquentjs/codegen` is the single source of truth for all code generation in the EloquentJS ecosystem. Instead of each package duplicating generation logic, they all call into this one engine:

```
Model class
    │
    ▼
introspect()  ──→  ModelSchema (normalized descriptor)
    │
    ├──→ generateGraphqlSchema()   → schema.graphql
    ├──→ generateTypeScriptFile()  → models.d.ts
    ├──→ generateOpenApiSpec()     → openapi.json / openapi.yaml
    ├──→ generateModelStub()       → app/models/User.js
    ├──→ generateMigrationStub()   → database/migrations/...
    ├──→ generateFactoryStub()     → database/factories/UserFactory.js
    └──→ generateSeederStub()      → database/seeders/UserSeeder.js
```

---

## Core Concept: ModelSchema

`introspect(ModelClass)` returns a normalized `ModelSchema` object. Every generator consumes this — you never need to pass raw Model classes into templates directly.

```js
import { introspect } from '@eloquentjs/codegen'

const schema = introspect(User)
// {
//   name: 'User',
//   table: 'users',
//   primaryKey: 'id',
//   softDeletes: false,
//   timestamps: true,
//   fillable: ['name', 'email'],
//   hidden: ['password'],
//   fields: [
//     { name: 'id',       cast: 'uuid',    gqlType: 'ID',      tsType: 'string',  openApiType: { type: 'string' },  isPk: true },
//     { name: 'name',     cast: 'string',  gqlType: 'String',  tsType: 'string',  openApiType: { type: 'string' },  fillable: true },
//     { name: 'is_admin', cast: 'boolean', gqlType: 'Boolean', tsType: 'boolean', openApiType: { type: 'boolean' }, hidden: false },
//     { name: 'created_at', cast: 'datetime', gqlType: 'DateTime', tsType: 'Date', isTimestamp: true },
//     ...
//   ],
//   relations: [
//     { name: 'posts', type: 'hasMany', related: 'Post', isList: true },
//     { name: 'profile', type: 'hasOne', related: 'Profile', isList: false },
//   ],
//   scopes: [
//     { name: 'active', methodName: 'scopeActive' },
//   ],
//   graphql: { hidden: Set, disabled: {}, subscription: true, middleware: [] },
//   ModelClass: User,
// }
```

---

## Introspection

```js
import { introspect, introspectAll } from '@eloquentjs/codegen'

// From a live Model class
const schema = introspect(User)

// From a plain descriptor (no database needed — for CLI scaffold)
const schema = introspect({
  name:        'Product',
  table:       'products',
  primaryKey:  'id',
  fillable:    ['name', 'price'],
  hidden:      [],
  casts:       { name: 'string', price: 'decimal:2', in_stock: 'boolean' },
  timestamps:  true,
  softDeletes: false,
})

// Multiple at once
const schemas = introspectAll([User, Post, Comment])
```

### Field Type Mapping

Every field in `ModelSchema.fields` includes all type representations:

| Cast                     | `gqlType`  | `tsType`                  | `openApiType.type`           |
| ------------------------ | ---------- | ------------------------- | ---------------------------- |
| `integer` / `int`        | `Int`      | `number`                  | `integer`                    |
| `float` / `double`       | `Float`    | `number`                  | `number`                     |
| `decimal:2`              | `Float`    | `number`                  | `number`                     |
| `string` / `text`        | `String`   | `string`                  | `string`                     |
| `boolean` / `bool`       | `Boolean`  | `boolean`                 | `boolean`                    |
| `date`                   | `DateTime` | `Date`                    | `string` (format: date)      |
| `datetime` / `timestamp` | `DateTime` | `Date`                    | `string` (format: date-time) |
| `json` / `jsonb`         | `JSON`     | `Record<string, unknown>` | `object`                     |
| `array`                  | `JSON`     | `unknown[]`               | `array`                      |
| `uuid`                   | `ID`       | `string`                  | `string` (format: uuid)      |

---

## Templates

### GraphQL SDL

```js
import { generateGraphqlSDL, generateGraphqlSchema } from '@eloquentjs/codegen'

// SDL fragments for one model (used by @eloquentjs/graphql internally)
const {
  typeDef,           // type User { ... }
  inputCreate,       // input CreateUserInput { ... }
  inputUpdate,       // input UpdateUserInput { ... }
  inputWhere,        // input UserWhereInput { ... }
  paginated,         // type UserPage { ... }
  queryLines,        // ['  user(id: ID!): User', ...]
  mutationLines,     // ['  createUser(...): User!', ...]
  subscriptionLines, // ['  userCreated: User!', ...]
} = generateGraphqlSDL(schema, {
  pagination:    'offset',  // 'offset' | 'relay'
  subscriptions: true,
})

// Complete standalone .graphql file for one or more models
const sdl = generateGraphqlSchema([userSchema, postSchema], {
  pagination:    'offset',
  subscriptions: true,
  scalars:       ['BigInt'],
  header:        true,      // include generation comment
})
// → write to schema.graphql
```

### TypeScript Types

```js
import { generateTypeScriptTypes, generateTypeScriptFile } from '@eloquentjs/codegen'

// Types for one model
const ts = generateTypeScriptTypes(schema, {
  includeCreateInput: true,
  includeUpdateInput: true,
  includeWhereInput:  false,
})
// → export interface User { id: string; name?: string; is_admin?: boolean; ... }
//   export interface CreateUserInput { name?: string; ... }
//   export interface UpdateUserInput { name?: string; ... }

// Full declaration file for all models
const file = generateTypeScriptFile(schemas, { header: true })
// → includes PaginationMeta, PaginatedResult<T>, all model interfaces
```

### OpenAPI 3.0

```js
import { generateOpenApiSpec } from '@eloquentjs/codegen'

const spec = generateOpenApiSpec(schemas, {
  title:    'My API',
  version:  '0.0.3',
  servers:  [{ url: 'https://api.example.com', description: 'Production' }],
  prefix:   '/api',
  security: [{ bearerAuth: [] }],
})
// Returns a full OpenAPI 3.0 spec object — serialize with JSON.stringify or a YAML lib
// Mirrors all routes generated by @eloquentjs/api:
//   GET/POST /api/users
//   GET/PUT/PATCH/DELETE /api/users/{id}
//   GET /api/users/trashed  (if softDeletes)
//   POST /api/users/{id}/restore  (if softDeletes)
```

### Source Stubs

```js
import {
  generateModelStub,
  generateMigrationStub,
  generateFactoryStub,
  generateSeederStub,
} from '@eloquentjs/codegen'

// Model class stub
const modelCode = generateModelStub(schema, {
  importPath:   '@eloquentjs/core',
  withComments: true,
})

// Migration with smart template detection
const migCode = generateMigrationStub('create_users_table')   // → CREATE TABLE template
const migCode = generateMigrationStub('add_avatar_to_users')  // → ALTER TABLE template
const migCode = generateMigrationStub('create_users_table', schema) // with typed columns from schema

// Factory with auto faker hints (name → faker.person.fullName(), email → faker.internet.email(), etc.)
const factCode = generateFactoryStub(schema, { modelsPath: '../models' })

// Seeder
const seedCode = generateSeederStub(schema, { factoriesPath: '../factories' })
```

---

## Render Engine

The render engine ties everything together — loads model files from disk and writes output:

```js
import {
  loadModelsFromDir,
  loadModelsByName,
  renderGraphql,
  renderTypeScript,
  renderOpenApi,
  renderStubs,
} from '@eloquentjs/codegen/render'

// Load all models from a directory
const models = await loadModelsFromDir('./app/models')

// Load specific models by name
const models = await loadModelsByName('./app/models', ['User', 'Post'])

// Generate and write schema.graphql
await renderGraphql({
  models,               // pass live classes...
  // modelsDir: './app/models',  // ...or load from directory
  outputFile: 'schema.graphql',
  options: { pagination: 'offset', subscriptions: true },
})

// Generate and write models.d.ts
await renderTypeScript({
  models,
  outputFile: 'src/types/models.d.ts',
})

// Generate and write openapi.json or openapi.yaml
await renderOpenApi({
  models,
  outputFile: 'docs/openapi.json',
  format:     'json',   // 'json' | 'yaml'
  options:    { title: 'My API' },
})

// Generate all stubs for a descriptor (no DB connection needed)
const stubs = renderStubs(schema)
// { model: '...', migration: '...', factory: '...', seeder: '...' }
```

---

## Using with @eloquentjs/graphql

`@eloquentjs/graphql` uses `@eloquentjs/codegen` internally. You don't need to call codegen directly for GraphQL — just use `buildSchema()` or the new `buildSchemaFromDir()`:

```js
import { buildSchema, buildSchemaFromDir } from '@eloquentjs/graphql'

// From live classes (original API — unchanged)
const { typeDefs, resolvers } = buildSchema([User, Post, Comment])

// From a models directory (new — uses codegen render engine)
const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models', {
  subscriptions: true,
  auth: async (ctx) => authenticateUser(ctx),
})
```

---

## Using with @eloquentjs/cli

The CLI's `make:model`, `make:migration`, `make:factory`, and `make:seeder` commands use codegen stubs when `@eloquentjs/codegen` is installed, automatically producing richer output. If codegen is not installed, the CLI falls back to its own inline generators — no hard dependency.

The `generate:*` commands require codegen:

```bash
eloquent generate:graphql           # writes schema.graphql
eloquent generate:types             # writes models.d.ts
eloquent generate:openapi           # writes openapi.json
```

See the [@eloquentjs/cli README](../cli/README.md) for full details.

---

## Exports

| Import path                      | Exports                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `@eloquentjs/codegen`            | `introspect`, `introspectAll`, `resolveCastType`, `CAST_TYPE_MAP`, all templates, all render functions       |
| `@eloquentjs/codegen/introspect` | `introspect`, `introspectAll`, `resolveCastType`, `CAST_TYPE_MAP`                                            |
| `@eloquentjs/codegen/templates`  | All template generators                                                                                      |
| `@eloquentjs/codegen/render`     | `loadModelsFromDir`, `loadModelsByName`, `renderGraphql`, `renderTypeScript`, `renderOpenApi`, `renderStubs` |

---

## License

MIT
