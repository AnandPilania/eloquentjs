# EloquentJS Agent Files

Ready-to-use context files for AI coding assistants. Drop them into your project to give any AI tool deep knowledge of the EloquentJS API, patterns, and conventions — no MCP required.

---

## Files at a Glance

| File | For | How to use |
|---|---|---|
| `CLAUDE.md` | Claude.ai (Projects or in-project) | Drop in project root — Claude reads it automatically |
| `GEMINI.md` | Gemini-based tools | Drop in project root or add to agent context |
| `.cursorrules` | Cursor | Drop in project root |
| `.windsurfrules` | Windsurf | Drop in project root |
| `copilot-instructions.md` | GitHub Copilot | Copy to `.github/copilot-instructions.md` |
| `skills/db-skill.md` | Any agent | Add to knowledge base or Claude Project |
| `skills/api-skill.md` | Any agent | REST API patterns |
| `skills/graphql-skill.md` | Any agent | GraphQL schema generation |
| `skills/validation-skill.md` | Any agent | Input validation patterns |
| `skills/migration-skill.md` | Any agent | Database migrations |
| `skills/realtime-skill.md` | Any agent | WebSocket broadcasting |
| `skills/mcp-skill.md` | Any agent | MCP server setup and tool reference |

---

## What Each File Covers

### `CLAUDE.md` / `GEMINI.md`
Full project reference for AI assistants: package overview, model definition syntax, query patterns, validation, REST API, GraphQL, migrations, CLI commands, error handling, coding conventions.

### `.cursorrules`
Cursor-format rules for code completion: import conventions, model file structure, query patterns (always-await, always-with), validation-before-write, error handling, file structure, when to use each package.

### `.windsurfrules`
Windsurf-format rules: critical rules in order of importance, model template, REST endpoint template, CLI commands.

### `copilot-instructions.md`
Copilot-format patterns: model pattern, query patterns, validation pattern, REST route pattern, migration pattern, completion rules.

---

## Skill Files (Deep Dives)

### `skills/db-skill.md`
- Complete model setup checklist
- Full query API (read, write, paginate, aggregate)
- All relation types with pivot operations
- N+1 prevention patterns
- Transactions
- Soft deletes
- Multiple connections

### `skills/api-skill.md`
- One-line CRUD with `apiRouter()` + `resource()`
- All resource options (middleware, with, searchable, sortable, filters, policy)
- Query parameter handling (?search, ?sort, ?with, ?page)
- Nested resources
- Validation integration
- Fastify plugin
- Error response mapping

### `skills/graphql-skill.md`
- Auto-generated schema from models
- Per-model graphql config (hide fields, disable ops, subscriptions)
- All options (pagination, auth, scalars)
- Extending resolvers
- Relay pagination
- CLI generation
- Type mapping (cast → GraphQL type)

### `skills/validation-skill.md`
- Decision guide (which API to use when)
- Complete fluent schema API
- Express and Fastify adapters
- `unique()` with `.ignore()` for updates
- Custom Rule objects (sync and async)
- Named rule functions
- Complete rule reference (all 40+ rules)
- Error structure

### `skills/migration-skill.md`
- Smart migration name templates
- Complete column type reference
- ALTER TABLE patterns (add, drop, rename columns; add/drop indexes)
- Production safety checklist
- Concurrency protection (advisory lock)
- Migration tracking table
- Schema inspection helpers

### `skills/realtime-skill.md`
- Server setup + cleanup
- `broadcastFrom()` with transform and filtering
- Manual broadcasting
- Client setup with auto-reconnect
- Private channels with auth
- Presence channels
- Pusher JS and Laravel Echo compatibility

### `skills/mcp-skill.md`
- Setup for Claude.ai, Cursor, Windsurf
- All 21 tools with params and return values
- `get_help` topic list
- `get_examples` topic list
- `nlp_query` and `nlp_crud` example prompts
- Security notes
- Programmatic use

---

## Recommended Setup per Tool

### Claude.ai Projects
1. Create a Claude Project for your repo
2. Upload `CLAUDE.md` as project knowledge
3. Upload whichever `skills/*.md` files are relevant
4. Or: run `eloquent-mcp` and add it as an MCP server in Claude Desktop

### Cursor
1. Copy `.cursorrules` to project root
2. Optionally add `skills/*.md` to `.cursor/rules/` directory

### Windsurf
1. Copy `.windsurfrules` to project root

### GitHub Copilot
1. Copy `copilot-instructions.md` to `.github/copilot-instructions.md`

### Any MCP-compatible tool (best experience)
1. `npm install -g @eloquentjs/mcp`
2. Configure the server in your tool's MCP settings
3. The agent gets 21 live tools including `get_help`, `nlp_query`, model introspection, and code generation
