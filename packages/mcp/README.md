# @eloquentjs/mcp

> Model Context Protocol server for EloquentJS. Lets AI agents (Claude.ai, Cursor, Windsurf, GitHub Copilot) query your database, introspect your models, run migrations, generate code, and get contextual help — all from inside the AI chat window.

```bash
npm install -g @eloquentjs/mcp
# or per-project
npm install --save-dev @eloquentjs/mcp
```

> **Powered by [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) v1.27.1** — supports MCP protocol `2025-11-25`, future transports (HTTP/SSE), and automatic version negotiation.

---

## What This Does

The MCP server exposes 21 tools that AI coding agents can call directly. Instead of reading your code manually or guessing at your schema, the agent can:

- Call `list_models` → get all models, fields, relations, casts in structured JSON
- Call `describe_database_schema` → see live columns and indexes from the actual database
- Call `query_model` → run a safe SELECT query to explore real data
- Call `get_help topic="soft-deletes"` → get docs and copy-paste examples instantly
- Call `nlp_query query="10 most recent active users with their posts"` → get the QueryBuilder code
- Call `generate_model` → scaffold a model + migration + factory with exact field types
- Call `run_migrations` → apply pending schema changes

---

## Quick Start

### Claude Desktop

`~/.claude/mcp_config.json`:
```json
{
  "mcpServers": {
    "eloquentjs": {
      "command": "npx",
      "args": ["@eloquentjs/mcp", "--cwd", "/absolute/path/to/your/project"]
    }
  }
}
```
Restart Claude Desktop. EloquentJS tools appear automatically.

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

### Run manually

```bash
# In your project directory
npx @eloquentjs/mcp

# Explicit path
eloquent-mcp --cwd /path/to/project
```

---

## All 21 Tools

### Introspection (5 tools — read-only, no DB required for model tools)

| Tool | Description |
|---|---|
| `list_models` | All models: fields with types, relations, casts, scopes, graphql config |
| `describe_model` | Full introspection of one model — every field, relation, scope, hook |
| `list_migrations` | Status of all migrations (ran/pending/batch number/timestamp) |
| `describe_database_schema` | Live table/column/index/FK info from the database |
| `get_project_structure` | Config file, paths, installed packages, model/migration counts |

### Code Generation (5 tools)

| Tool | Key params | Description |
|---|---|---|
| `generate_model` | `name`, `fields{}`, `relations[]`, `write?` | Generate model (+ optional migration/factory/seeder) |
| `generate_migration` | `name`, `fromModel?`, `write?` | Migration with smart templates (create/add/drop/rename) |
| `generate_graphql_schema` | `models[]?`, `pagination?`, `write?` | Full GraphQL SDL from all models |
| `generate_typescript_types` | `models[]?`, `write?` | TypeScript interfaces from all models |
| `generate_openapi_spec` | `models[]?`, `format?`, `write?` | OpenAPI 3.0 spec (JSON or YAML) |

> All generation tools return code as a string by default. Pass `write: true` to save files to disk.

### Query & Execution (6 tools)

| Tool | Key params | Description |
|---|---|---|
| `query_model` | `model`, `where{}?`, `orderBy?`, `limit?`, `with[]?` | Safe SELECT (100 row cap) |
| `run_raw_query` | `sql` (SELECT/EXPLAIN only), `params[]?` | Raw SQL — SELECT and EXPLAIN only |
| `run_migrations` | `dryRun?` | Run pending migrations (or preview with dryRun) |
| `rollback_migration` | `step?` | Roll back last N batches |
| `migration_status` | — | All migrations with ran/pending/batch info |
| `run_seeder` | `seeder?` | Execute a seeder class |

### Developer Help (5 tools)

| Tool | Key params | Description |
|---|---|---|
| `get_help` | `topic` or `search` | Docs + quick-start code for any topic |
| `get_method_signature` | `method` | Exact signature, return type, description |
| `get_examples` | `topic` | Copy-paste code for common patterns |
| `nlp_query` | `query`, `execute?` | Natural language → QueryBuilder chain |
| `nlp_crud` | `instruction`, `execute?` | Natural language → CRUD operation code |

#### `get_help` topics
`model` · `query-builder` · `relations` · `casts` · `scopes` · `hooks` · `events` · `soft-deletes` · `validation` · `migrations` · `graphql` · `api` · `realtime` · `mcp`

#### `get_examples` topics
`pagination` · `eager-loading` · `transactions` · `soft-deletes` · `validation` · `factory`

#### `nlp_query` examples
```
"get the 10 most recent active users with their posts"
"count all admin users created this week"
"find posts created today ordered by title"
"get users with their roles oldest first"
```

#### `nlp_crud` examples
```
"create a User named Alice with email alice@example.com"
"update User 42 set is_admin to true"
"delete Post 7"
"find User with id 5"
```

---

## Example Agent Interactions

### "What models do I have?"
```
Agent calls: list_models
→ Gets: JSON with all model names, tables, fields, relations, casts, scopes
No file reading needed.
```

### "Add an avatar_url field to User"
```
1. describe_model User → current schema
2. generate_migration add_avatar_url_to_users → migration code
3. run_migrations → apply it
4. generate_typescript_types → update types
All in one conversation.
```

### "Show me the 5 most recent users"
```
Agent calls: query_model { model: "User", orderBy: "created_at", order: "desc", limit: 5 }
→ Gets: real data from the database
```

### "How do I paginate in EloquentJS?"
```
Agent calls: get_help { topic: "query-builder" }
→ Gets: full docs with pagination code example

Agent calls: get_examples { topic: "pagination" }
→ Gets: copy-paste pagination code
```

### "Generate a BlogPost model"
```
Agent calls: generate_model {
  name: "BlogPost",
  fields: { title: "string", body: "text", is_published: "boolean", views: "integer" },
  relations: [{ name: "user", type: "belongsTo", related: "User" }],
  withMigration: true,
  withFactory: true,
  write: true
}
→ Creates: BlogPost.js, 20240321_create_blog_posts_table.js, BlogPostFactory.js
```

---

## Prompts

Three guided **prompts** help agents follow best practices:

| Prompt | Description |
|---|---|
| `scaffold_feature` | Step-by-step: introspect → generate → migrate → types |
| `debug_query` | Check schema → describe model → fix N+1 and operators |
| `review_migrations` | List pending → flag dangerous changes → production safety check |

In Claude Desktop, these appear in the "Insert prompt" menu.

---

## Resources

Three readable **resources** agents can reference:

| URI | Description |
|---|---|
| `eloquentjs://schema` | Full model schema as JSON |
| `eloquentjs://models` | Model list with file paths |
| `eloquentjs://config` | Current `eloquent.config.js` |

---

## Agent Files

The `agent-files/` directory in the root of this repo contains ready-to-use files for AI tools that don't use MCP:

- `CLAUDE.md` — drop in project root, Claude reads it automatically
- `GEMINI.md` — same for Gemini-based tools
- `.cursorrules` — Cursor rules file
- `.windsurfrules` — Windsurf rules file
- `copilot-instructions.md` → copy to `.github/copilot-instructions.md`
- `skills/db-skill.md` — deep database patterns
- `skills/api-skill.md` — REST API patterns
- `skills/mcp-skill.md` — MCP setup and tool reference

---

## Security

- **`query_model`** — only SELECT queries via QueryBuilder; 100 row cap
- **`run_raw_query`** — only SELECT, WITH, EXPLAIN; throws immediately on INSERT/UPDATE/DELETE/DROP
- **`generate_*`** — returns code strings by default; `write: true` required to touch the filesystem
- **`run_migrations`** / **`run_seeder`** — use your `eloquent.config.js` connection settings
- No credentials are exposed through MCP tools

---

## Programmatic Use

```js
import { createServer, startStdio } from '@eloquentjs/mcp'

// Create server instance with custom config
const server = createServer({
  cwd: process.cwd(),
  config: {
    paths:      { models: 'src/models', migrations: 'src/migrations' },
    // driver: 'pgsql' | 'mongodb' | 'sqlite' (resolved via the matching @eloquentjs/<driver> package)
    connection: { driver: 'pgsql', url: process.env.DATABASE_URL },
  },
})

// Start on stdio (standard MCP transport)
await startStdio({ cwd: process.cwd() })
```

---

## Protocol

Built on the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) v1.27.1. Supports MCP protocol version `2025-11-25` over stdio (JSON-RPC 2.0 with `Content-Length` framing). Server capabilities: `tools`, `resources`, `prompts`.

---

## License

MIT
