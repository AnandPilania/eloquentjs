# @eloquentjs/cli

> The official CLI for EloquentJS — scaffold, migrate, seed, and manage your project from the terminal.

---

## Installation

```bash
# Install globally
npm install -g @eloquentjs/cli

# Or use via npx
npx @eloquentjs/cli <command>

# Or within a monorepo / local project
npm install --save-dev @eloquentjs/cli
```

After global install, the `eloquent` (or `ejs`) command is available everywhere.

---

## Quick Start

```bash
# Initialize EloquentJS in your project
eloquent init

# Initialize with a different driver (pgsql is the default)
eloquent init --driver=mongodb
eloquent init --driver=sqlite

# Create a model
eloquent make:model User

# Create a model + migration + factory + seeder all at once
eloquent make:model Post --all

# Run migrations
eloquent migrate

# Seed the database
eloquent db:seed
```

---

## All Commands

### Project Setup

| Command | Description |
|---|---|
| `eloquent init` | Scaffold `eloquent.config.js`, directory structure, and `.env.example` |
| `eloquent init --driver=mongodb` | Initialize with MongoDB driver |
| `eloquent init --driver=sqlite` | Initialize with SQLite driver |
| `eloquent list` | List all available commands |

### Generators (`make:*`)

| Command | Description |
|---|---|
| `eloquent make:model <Name>` | Generate a model class |
| `eloquent make:model <Name> --migration` | Model + migration |
| `eloquent make:model <Name> --factory` | Model + factory |
| `eloquent make:model <Name> --seed` | Model + seeder |
| `eloquent make:model <Name> --all` | Model + migration + factory + seeder |
| `eloquent make:model <Name> --soft-deletes` | Add `softDeletes = true` |
| `eloquent make:migration <name>` | Generate a migration file |
| `eloquent make:seeder <Name>` | Generate a seeder class |
| `eloquent make:factory <Name>` | Generate a factory class |

**Smart migration templates** — the CLI detects your intent from the name:

```bash
eloquent make:migration create_users_table       # → CREATE TABLE template
eloquent make:migration add_avatar_to_users      # → ALTER TABLE ADD COLUMN template
eloquent make:migration drop_bio_from_profiles   # → ALTER TABLE DROP COLUMN template
eloquent make:migration rename_posts_to_articles # → RENAME TABLE template
eloquent make:migration drop_old_logs_table      # → DROP TABLE template
```

### Migrations

| Command | Description |
|---|---|
| `eloquent migrate` | Run all pending migrations |
| `eloquent migrate:rollback` | Rollback the last batch |
| `eloquent migrate:rollback --step=3` | Rollback the last 3 batches |
| `eloquent migrate:reset` | Rollback ALL migrations |
| `eloquent migrate:refresh` | Reset + re-run all migrations |
| `eloquent migrate:refresh --seed` | Refresh then seed |
| `eloquent migrate:fresh` | Drop all tables + re-run migrations |
| `eloquent migrate:fresh --seed` | Fresh + seed |
| `eloquent migrate:status` | Show which migrations have run |

### Database

| Command | Description |
|---|---|
| `eloquent db:seed` | Run `DatabaseSeeder` |
| `eloquent db:seed --class=UserSeeder` | Run a specific seeder |
| `eloquent db:wipe --force` | Drop all tables (requires `--force`) |

### Generate (from live models)

These commands load your actual model files, introspect them via `@eloquentjs/codegen`, and write output files. Requires `@eloquentjs/codegen` to be installed.

```bash
npm install @eloquentjs/codegen
```

| Command | Output | Description |
|---|---|---|
| `eloquent generate:graphql` | `schema.graphql` | Full GraphQL SDL from all models |
| `eloquent generate:types` | `src/types/models.d.ts` | TypeScript interfaces for all models |
| `eloquent generate:openapi` | `openapi.json` | OpenAPI 3.0 spec mirroring your REST routes |

**Options shared by all `generate:*` commands:**

| Flag | Description |
|---|---|
| `--models=User,Post` | Generate for specific models only |
| `--models-dir=<path>` | Override the models directory (default: from `eloquent.config.js`) |
| `--out=<file>` | Custom output file path |

**`generate:graphql` options:**

```bash
eloquent generate:graphql                           # all models → schema.graphql
eloquent generate:graphql --out=src/schema.graphql  # custom output path
eloquent generate:graphql --pagination=relay         # use Relay cursor pagination
eloquent generate:graphql --no-subscriptions         # exclude Subscription type
eloquent generate:graphql --models=User,Post         # specific models only
```

**`generate:types` options:**

```bash
eloquent generate:types                             # all models → src/types/models.d.ts
eloquent generate:types --out=types/index.d.ts      # custom path
```

Generated file includes `PaginationMeta`, `PaginatedResult<T>`, and an interface + `CreateInput` + `UpdateInput` for every model.

**`generate:openapi` options:**

```bash
eloquent generate:openapi                           # → openapi.json
eloquent generate:openapi --format=yaml             # → openapi.yaml
eloquent generate:openapi --out=docs/openapi.json   # custom path
eloquent generate:openapi --title="My API"          # custom title
```

Generated spec mirrors all routes from `@eloquentjs/api` including pagination query params, soft-delete routes, and error response schemas. View it with:

```bash
npx @redocly/cli preview-docs openapi.json
# or
npx swagger-ui-cli openapi.json
```

### Global Flags

| Flag | Description |
|---|---|
| `--force` / `-f` | Overwrite existing files, skip confirmations |
| `--verbose` / `-v` | Print full error stack traces |

---

## Configuration (`eloquent.config.js`)

Generated by `eloquent init`. Customize paths and connection:

```js
export default {
  connection: {
    driver:   'pgsql',
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE ?? 'myapp',
    user:     process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
  },

  paths: {
    models:     'app/models',        // where models are generated
    migrations: 'database/migrations',
    seeders:    'database/seeders',
    factories:  'database/factories',
  },
}
```

---

## Generated File Examples

### Model (`eloquent make:model Post --all`)

```js
// app/models/Post.js
import { Model } from '@eloquentjs/core'

export default class Post extends Model {
  static table    = 'posts'
  static fillable = []
  static hidden   = []

  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
  }

  // posts()   { return this.hasMany(Comment) }
  // static scopePublished(qb) { return qb.where('status', 'published') }
  // static async creating(record) { }
}
```

### Migration (`eloquent make:migration create_posts_table`)

```js
// database/migrations/20240315120000_create_posts_table.js
import { Migration, Schema } from '@eloquentjs/core'

export default class CreatePostsTable extends Migration {
  async up() {
    await Schema.create('posts', t => {
      t.id()
      // t.string('title')
      // t.text('body').nullable()
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('posts')
  }
}
```

### Seeder

```js
// database/seeders/PostSeeder.js
import { Seeder } from '@eloquentjs/core'

export default class PostSeeder extends Seeder {
  async run() {
    // await PostFactory.new().count(10).create()
    console.log('PostSeeder done.')
  }
}
```

### Factory

```js
// database/factories/PostFactory.js
import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Post from '../../app/models/Post.js'

export default class PostFactory extends Factory {
  model = Post

  definition() {
    return {
      // title: faker.lorem.sentence(),
      // body:  faker.lorem.paragraphs(3),
    }
  }

  // published() { return this.state({ status: 'published' }) }
}
```

---

## Migration Tracking

Migrations are tracked in a `_migrations` table created automatically in your database:

```
_migrations
  id          SERIAL PRIMARY KEY
  migration   VARCHAR(255) UNIQUE   ← filename e.g. 20240315_create_users_table.js
  batch       INTEGER               ← group number for rollbacks
  ran_at      TIMESTAMPTZ
```

Rollbacks undo the last batch by default. Use `--step=N` to roll back multiple batches.

---

## Workflow Example

```bash
# 1. New project
mkdir myapp && cd myapp
npm init -y
npm install @eloquentjs/core @eloquentjs/pgsql @eloquentjs/cli
eloquent init

# 2. Create models
eloquent make:model User --all
eloquent make:model Post --migration --factory

# 3. Edit migrations, then run
eloquent migrate
eloquent migrate:status

# 4. Seed data
eloquent db:seed --class=UserSeeder

# 5. During development — wipe and start fresh
eloquent migrate:fresh --seed
```

---

## AI Agent Integration

### MCP Server (`@eloquentjs/mcp`)

If you use AI coding tools that support MCP (Claude.ai Desktop, Cursor, Windsurf), install the MCP server for the best experience. The agent gets 21 tools to introspect your models, generate code, run migrations, and look up documentation — without reading your files manually.

```bash
npm install -g @eloquentjs/mcp

# Claude Desktop (~/.claude/mcp_config.json)
# { "mcpServers": { "eloquentjs": { "command": "npx", "args": ["@eloquentjs/mcp", "--cwd", "/path/to/project"] } } }

eloquent-mcp --cwd .    # start the server
```

See [`@eloquentjs/mcp`](../mcp/README.md) for full setup instructions.

### Agent Files (no MCP required)

For tools that don't use MCP, the `agent-files/` directory in the monorepo root contains ready-to-use context files:

| File | Drop it here |
|---|---|
| `CLAUDE.md` | Project root (auto-loaded by Claude) |
| `.cursorrules` | Project root |
| `.windsurfrules` | Project root |
| `copilot-instructions.md` | `.github/copilot-instructions.md` |
| `skills/db-skill.md` | Any agent knowledge base |

---

## License

MIT
