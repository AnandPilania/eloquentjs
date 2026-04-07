# EloquentJS MCP Skill

## When to use this skill
Use when setting up the `@eloquentjs/mcp` server or using MCP tools to build/debug an EloquentJS project.

---

## Setup

### Install
```bash
npm install -g @eloquentjs/mcp
# or per-project
npm install --save-dev @eloquentjs/mcp
```

### Claude Desktop
`~/.claude/mcp_config.json`:
```json
{
  "mcpServers": {
    "eloquentjs": {
      "command": "npx",
      "args": ["@eloquentjs/mcp", "--cwd", "/absolute/path/to/project"]
    }
  }
}
```

### Cursor
Settings → MCP Servers → Add:
```json
{
  "name": "eloquentjs",
  "command": "npx @eloquentjs/mcp --cwd ${workspaceFolder}"
}
```

### Windsurf
`.windsurf/mcp.json`:
```json
{
  "servers": {
    "eloquentjs": {
      "command": "eloquent-mcp",
      "args": ["--cwd", "${workspaceFolder}"]
    }
  }
}
```

---

## Recommended Tool Workflow

### Starting a feature
1. `get_project_structure` → understand what's configured
2. `list_models` → see what models exist
3. `get_help topic="query-builder"` → review the query API
4. `generate_model` with fields + `write: false` → preview code
5. `generate_model` with `write: true, withMigration: true` → create files
6. `run_migrations` → apply schema changes
7. `generate_graphql_schema` → update SDL
8. `generate_typescript_types` → update .d.ts

### Debugging a query
1. `describe_model ModelName` → check fields and relations
2. `describe_database_schema table="table_name"` → check actual columns
3. `get_examples topic="eager-loading"` → see N+1 prevention patterns
4. `nlp_query query="..."` → generate QueryBuilder from description
5. `query_model model="ModelName" where={...} limit=5` → test against live data

### Before deploying
1. `migration_status` → see pending migrations
2. `get_help topic="migrations"` → review migration patterns
3. `run_migrations dryRun=true` → preview what would run

---

## All 21 Tools

### Introspection (read-only, no DB required for model tools)
| Tool | Key params | Returns |
|---|---|---|
| `list_models` | `modelsDir?` | All models with fields, relations, casts |
| `describe_model` | `model` (name) | Full schema: fields, relations, scopes, graphql config |
| `list_migrations` | `migrationsDir?` | Status of all migrations (ran/pending/batch) |
| `describe_database_schema` | `table?` | Live columns, indexes, foreign keys |
| `get_project_structure` | — | Config, paths, installed packages, counts |

### Code Generation
| Tool | Key params | Returns |
|---|---|---|
| `generate_model` | `name`, `fields{}`, `relations[]`, `write?` | Model code + optional files |
| `generate_migration` | `name`, `fromModel?`, `write?` | Migration code |
| `generate_graphql_schema` | `models[]?`, `pagination?`, `write?` | SDL string |
| `generate_typescript_types` | `models[]?`, `write?` | .d.ts string |
| `generate_openapi_spec` | `models[]?`, `format?`, `write?` | OpenAPI 3.0 object |

### Query & Execute
| Tool | Key params | Returns |
|---|---|---|
| `query_model` | `model`, `where{}?`, `limit?`, `with[]?` | Records (capped at 100) |
| `run_raw_query` | `sql` (SELECT only), `params[]?` | Rows |
| `run_migrations` | `dryRun?` | Ran count or preview |
| `rollback_migration` | `step?` | Rolled back count |
| `migration_status` | — | All migrations with ran/pending/batch |
| `run_seeder` | `seeder?` | Completion message |

### Developer Help
| Tool | Key params | Returns |
|---|---|---|
| `get_help` | `topic` or `search` | Docs, quickStart, seeAlso |
| `get_method_signature` | `method` | Signature, return type, description |
| `get_examples` | `topic` | Copy-paste code block |
| `nlp_query` | `query`, `execute?` | QueryBuilder code + optional results |
| `nlp_crud` | `instruction`, `execute?` | CRUD code + explanation |

---

## Available get_help Topics
`model` · `query-builder` · `relations` · `casts` · `scopes` · `hooks` · `events` · `soft-deletes` · `validation` · `migrations` · `graphql` · `api` · `realtime` · `mcp`

## Available get_examples Topics
`pagination` · `eager-loading` · `transactions` · `soft-deletes` · `validation` · `factory`

---

## Security Notes

- `query_model` — SELECT only, capped at 100 rows
- `run_raw_query` — only SELECT, WITH, EXPLAIN; throws on INSERT/UPDATE/DELETE/DROP
- `generate_*` tools — return code strings by default; require `write: true` to write files
- `run_migrations` / `run_seeder` — use your `eloquent.config.js` connection settings

---

## Programmatic Use

```js
import { createServer, startStdio } from '@eloquentjs/mcp'

// Create server with custom config
const server = createServer({
  cwd: process.cwd(),
  config: {
    paths:      { models: 'src/models', migrations: 'src/migrations' },
    connection: { driver: 'pgsql', url: process.env.DATABASE_URL },
  },
})

// Start on stdio (for MCP clients)
await startStdio({ cwd: process.cwd() })
```
