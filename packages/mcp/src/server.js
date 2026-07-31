/**
 * @eloquentjs/mcp — MCP Server (using @modelcontextprotocol/sdk)
 *
 * Full MCP server built on the official SDK.
 * Transports: stdio (default), SSE (HTTP) via --http flag.
 *
 * Capabilities:
 *   Tools (21):     introspect, generate, query, execute, help/nlp
 *   Resources (3):  eloquentjs://schema, models, config
 *   Prompts (3):    scaffold_feature, debug_query, review_migrations
 */

import { readFileSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { ALL_TOOLS } from './tools/index.js'
import {
    handleListModels, handleDescribeModel, handleListMigrations,
    handleDescribeDatabaseSchema, handleGetProjectStructure,
} from './tools/introspect.js'
import {
    handleGenerateModel, handleGenerateMigration, handleGenerateGraphqlSchema,
    handleGenerateTypeScriptTypes, handleGenerateOpenApiSpec,
} from './tools/generate.js'
import {
    handleQueryModel, handleRunRawQuery, handleRunMigrations,
    handleRollbackMigration, handleMigrationStatus, handleRunSeeder,
} from './tools/query.js'
import {
    handleGetHelp, handleGetMethodSignature, handleGetExamples,
    handleNlpQuery, handleNlpCrud,
} from './tools/help.js'

const SERVER_NAME = 'eloquentjs'
// Read from our own package.json so it never drifts (it had been pinned at 0.0.2).
const SERVER_VERSION = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

// ─── RESOURCES ────────────────────────────────────────────────────────────────
const RESOURCES = [
    {
        uri: 'eloquentjs://schema',
        name: 'Database Schema',
        description: 'Full introspection of all models: fields, relations, casts, scopes.',
        mimeType: 'application/json',
    },
    {
        uri: 'eloquentjs://models',
        name: 'Model List',
        description: 'List of all EloquentJS model files in this project.',
        mimeType: 'application/json',
    },
    {
        uri: 'eloquentjs://config',
        name: 'EloquentJS Config',
        description: 'Current eloquent.config.js settings.',
        mimeType: 'application/json',
    },
]

// ─── PROMPTS ──────────────────────────────────────────────────────────────────
const PROMPTS = [
    {
        name: 'scaffold_feature',
        description: 'Step-by-step guided workflow for scaffolding a full feature: model + migration + API + GraphQL + TypeScript types.',
        arguments: [
            { name: 'feature', description: 'Feature name, e.g. "blog posts", "payment subscriptions"', required: true },
            { name: 'fields', description: 'Fields as "name:string, price:decimal, active:boolean"', required: false },
        ],
    },
    {
        name: 'debug_query',
        description: 'Analyze and fix a slow or incorrect EloquentJS query. Checks schema, suggests indexes, fixes N+1.',
        arguments: [
            { name: 'query', description: 'The QueryBuilder chain or SQL to debug.', required: true },
        ],
    },
    {
        name: 'review_migrations',
        description: 'Review pending migrations for production safety. Flags destructive changes.',
        arguments: [],
    },
]

// ─── Server factory ───────────────────────────────────────────────────────────

export function createServer(options = {}) {
    const cwd = options.cwd ?? process.cwd()
    const config = options.config ?? null

    // Load config lazily
    let _config = config
    async function getConfig() {
        if (_config) return _config
        try {
            const { existsSync } = await import('fs')
            const { resolve } = await import('path')
            const { pathToFileURL } = await import('node:url')
            const cfgPath = resolve(cwd, 'eloquent.config.js')
            if (existsSync(cfgPath)) {
                const mod = await import(pathToFileURL(cfgPath).href)
                _config = mod.default
            }
        } catch { }
        return _config
    }

    function ctx() {
        return { cwd, config: _config, flags: {}, positional: [] }
    }

    // ── Create SDK server ────────────────────────────────────────────────────
    const server = new Server(
        { name: SERVER_NAME, version: SERVER_VERSION },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {},
            },
        }
    )

    // ── tools/list ───────────────────────────────────────────────────────────
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: ALL_TOOLS,
    }))

    // ── tools/call ───────────────────────────────────────────────────────────
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        await getConfig()
        const { name, arguments: args = {} } = request.params
        const c = ctx()

        try {
            let result

            switch (name) {
                // Introspect
                case 'list_models': result = await handleListModels(args, c); break
                case 'describe_model': result = await handleDescribeModel(args, c); break
                case 'list_migrations': result = await handleListMigrations(args, c); break
                case 'describe_database_schema': result = await handleDescribeDatabaseSchema(args, c); break
                case 'get_project_structure': result = await handleGetProjectStructure(args, c); break
                // Generate
                case 'generate_model': result = await handleGenerateModel(args, c); break
                case 'generate_migration': result = await handleGenerateMigration(args, c); break
                case 'generate_graphql_schema': result = await handleGenerateGraphqlSchema(args, c); break
                case 'generate_typescript_types': result = await handleGenerateTypeScriptTypes(args, c); break
                case 'generate_openapi_spec': result = await handleGenerateOpenApiSpec(args, c); break
                // Query / Execute
                case 'query_model': result = await handleQueryModel(args, c); break
                case 'run_raw_query': result = await handleRunRawQuery(args, c); break
                case 'run_migrations': result = await handleRunMigrations(args, c); break
                case 'rollback_migration': result = await handleRollbackMigration(args, c); break
                case 'migration_status': result = await handleMigrationStatus(args, c); break
                case 'run_seeder': result = await handleRunSeeder(args, c); break
                // Developer help
                case 'get_help': result = await handleGetHelp(args, c); break
                case 'get_method_signature': result = await handleGetMethodSignature(args, c); break
                case 'get_examples': result = await handleGetExamples(args, c); break
                case 'nlp_query': result = await handleNlpQuery(args, c); break
                case 'nlp_crud': result = await handleNlpCrud(args, c); break

                default:
                    return {
                        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                        isError: true,
                    }
            }

            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            }
        } catch (err) {
            return {
                content: [{ type: 'text', text: `Error: ${err.message}\n${err.stack ?? ''}` }],
                isError: true,
            }
        }
    })

    // ── resources/list ───────────────────────────────────────────────────────
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
        resources: RESOURCES,
    }))

    // ── resources/read ───────────────────────────────────────────────────────
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
        await getConfig()
        const { uri } = request.params
        const c = ctx()

        let text
        switch (uri) {
            case 'eloquentjs://schema': {
                const result = await handleListModels({}, c).catch(e => ({ error: e.message }))
                text = JSON.stringify(result, null, 2)
                break
            }
            case 'eloquentjs://models': {
                const result = await handleListModels({}, c).catch(e => ({ error: e.message }))
                const models = result.models?.map(m => ({
                    name: m.name, table: m.table, file: m.file,
                    fields: m.fieldCount, relations: m.relations?.length ?? 0,
                })) ?? []
                text = JSON.stringify({ models, total: models.length }, null, 2)
                break
            }
            case 'eloquentjs://config': {
                text = JSON.stringify(_config ?? {}, null, 2)
                break
            }
            default:
                throw new Error(`Unknown resource: ${uri}`)
        }

        return {
            contents: [{ uri, mimeType: 'application/json', text }],
        }
    })

    // ── prompts/list ─────────────────────────────────────────────────────────
    server.setRequestHandler(ListPromptsRequestSchema, async () => ({
        prompts: PROMPTS,
    }))

    // ── prompts/get ──────────────────────────────────────────────────────────
    server.setRequestHandler(GetPromptRequestSchema, async (request) => {
        const { name, arguments: args = {} } = request.params

        switch (name) {
            case 'scaffold_feature': {
                const feature = args.feature ?? 'the feature'
                const fields = args.fields ?? 'name:string'
                return {
                    description: `Scaffold a complete EloquentJS feature for: ${feature}`,
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                `I want to scaffold a complete EloquentJS feature for: **${feature}**.`,
                                `Fields: ${fields}`,
                                ``,
                                `Please follow these steps:`,
                                `1. Call \`list_models\` to see what already exists in this project`,
                                `2. Call \`get_help\` with topic "model" to review the model API`,
                                `3. Call \`generate_model\` with the field definitions to preview the code (write: false first)`,
                                `4. Once confirmed, call \`generate_model\` with write: true, withMigration: true, withFactory: true, withSeeder: true`,
                                `5. Call \`generate_graphql_schema\` to show the updated SDL`,
                                `6. Call \`generate_typescript_types\` to show the TypeScript interfaces`,
                                `7. Summarize exactly what files were created, what routes are available, and what the agent should do next`,
                            ].join('\n'),
                        },
                    }],
                }
            }

            case 'debug_query': {
                const query = args.query ?? 'the query'
                return {
                    description: 'Debug an EloquentJS query',
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                `Help me debug this EloquentJS query:`,
                                `\`\`\`js`,
                                query,
                                `\`\`\``,
                                ``,
                                `Please:`,
                                `1. Call \`describe_database_schema\` for the relevant table`,
                                `2. Call \`describe_model\` for the model involved`,
                                `3. Call \`get_examples\` with the relevant method name to see correct usage`,
                                `4. Identify issues: N+1 problems, missing eager loads, wrong operators, missing indexes`,
                                `5. Show the corrected query with explanation`,
                            ].join('\n'),
                        },
                    }],
                }
            }

            case 'review_migrations': {
                return {
                    description: 'Review pending migrations for production safety',
                    messages: [{
                        role: 'user',
                        content: {
                            type: 'text',
                            text: [
                                `Review the pending migrations for production safety.`,
                                ``,
                                `Please:`,
                                `1. Call \`migration_status\` to see all pending migrations`,
                                `2. For each pending migration, describe what schema change it makes`,
                                `3. Flag any that are potentially dangerous in production:`,
                                `   - Dropping or renaming columns (data loss risk)`,
                                `   - Removing indexes (performance risk)`,
                                `   - Adding NOT NULL columns without defaults (migration failure risk)`,
                                `   - Renaming tables (breaks running queries)`,
                                `4. Give a go/no-go recommendation with reasons`,
                            ].join('\n'),
                        },
                    }],
                }
            }

            default:
                throw new Error(`Unknown prompt: ${name}`)
        }
    })

    return server
}

// ─── Start on stdio ───────────────────────────────────────────────────────────

export async function startStdio(options = {}) {
    const server = createServer(options)
    const transport = new StdioServerTransport()
    await server.connect(transport)
    process.stderr.write(`[EloquentJS MCP] Server ready (stdio) — ${ALL_TOOLS.length} tools\n`)
    return server
}
