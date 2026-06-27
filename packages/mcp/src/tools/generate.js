/**
 * MCP Tools — Code Generation
 *
 * Lets AI agents generate models, migrations, factories, seeders,
 * GraphQL SDL, TypeScript types, and OpenAPI specs without running CLI commands.
 */

import { resolve } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'

// ─── Tool definitions ──────────────────────────────────────────────────────────

export const generateTools = [
    {
        name: 'generate_model',
        description: 'Generate a new EloquentJS model file. Optionally also generates migration, factory, and seeder. Returns the generated code and file path.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Model class name in PascalCase (e.g. "BlogPost").',
                },
                fields: {
                    type: 'object',
                    description: 'Field definitions as { fieldName: castType }. E.g. { title: "string", is_published: "boolean", view_count: "integer" }.',
                    additionalProperties: { type: 'string' },
                },
                relations: {
                    type: 'array',
                    description: 'Relation definitions. E.g. [{ name: "posts", type: "hasMany", related: "Post" }].',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            type: { type: 'string', enum: ['hasOne', 'hasMany', 'belongsTo', 'belongsToMany', 'hasManyThrough', 'morphTo', 'morphMany'] },
                            related: { type: 'string' },
                        },
                        required: ['name', 'type', 'related'],
                    },
                },
                fillable: { type: 'array', items: { type: 'string' } },
                hidden: { type: 'array', items: { type: 'string' } },
                softDeletes: { type: 'boolean', default: false },
                timestamps: { type: 'boolean', default: true },
                withMigration: { type: 'boolean', default: false, description: 'Also generate a migration file.' },
                withFactory: { type: 'boolean', default: false, description: 'Also generate a factory file.' },
                withSeeder: { type: 'boolean', default: false, description: 'Also generate a seeder file.' },
                write: { type: 'boolean', default: false, description: 'Write files to disk. If false, only returns the generated code.' },
                modelsDir: { type: 'string' },
            },
            required: ['name'],
        },
    },
    {
        name: 'generate_migration',
        description: 'Generate a migration file from a name or from an existing model schema. Smart templates detect create/add/drop/rename from the name.',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Migration name in snake_case. E.g. "create_users_table", "add_avatar_to_users", "drop_old_logs_table".',
                },
                fromModel: {
                    type: 'string',
                    description: 'Generate columns from an existing model\'s casts. Provide model class name.',
                },
                write: { type: 'boolean', default: false },
                migrationsDir: { type: 'string' },
            },
            required: ['name'],
        },
    },
    {
        name: 'generate_graphql_schema',
        description: 'Generate a complete GraphQL SDL schema from all models or specific models. Returns the SDL string.',
        inputSchema: {
            type: 'object',
            properties: {
                models: { type: 'array', items: { type: 'string' }, description: 'Model names to include. Omit for all models.' },
                pagination: { type: 'string', enum: ['offset', 'relay'], default: 'offset' },
                subscriptions: { type: 'boolean', default: true },
                write: { type: 'boolean', default: false },
                outputFile: { type: 'string', default: 'schema.graphql' },
                modelsDir: { type: 'string' },
            },
        },
    },
    {
        name: 'generate_typescript_types',
        description: 'Generate TypeScript interface declarations for all models or specific models.',
        inputSchema: {
            type: 'object',
            properties: {
                models: { type: 'array', items: { type: 'string' } },
                write: { type: 'boolean', default: false },
                outputFile: { type: 'string', default: 'src/types/models.d.ts' },
                modelsDir: { type: 'string' },
            },
        },
    },
    {
        name: 'generate_openapi_spec',
        description: 'Generate an OpenAPI 3.0 specification from all models, mirroring the REST routes from @eloquentjs/api.',
        inputSchema: {
            type: 'object',
            properties: {
                models: { type: 'array', items: { type: 'string' } },
                title: { type: 'string', default: 'API' },
                version: { type: 'string', default: '0.0.3' },
                format: { type: 'string', enum: ['json', 'yaml'], default: 'json' },
                write: { type: 'boolean', default: false },
                outputFile: { type: 'string' },
                modelsDir: { type: 'string' },
            },
        },
    },
]

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleGenerateModel(args, ctx) {
    const { introspect } = await import('@eloquentjs/codegen/introspect')
    const {
        generateModelStub, generateMigrationStub,
        generateFactoryStub, generateSeederStub,
    } = await import('@eloquentjs/codegen/templates')
    const { resolveConfig, toPascalCase, toTableName, migrationTimestamp } =
        await import('../../../cli/src/utils.js')

    const cfg = resolveConfig(ctx)
    const name = toPascalCase(args.name)
    const table = toTableName(name)

    const descriptor = {
        name,
        table,
        primaryKey: 'id',
        fillable: args.fillable ?? Object.keys(args.fields ?? {}),
        hidden: args.hidden ?? [],
        casts: args.fields ?? {},
        timestamps: args.timestamps !== false,
        softDeletes: args.softDeletes === true,
        relations: args.relations ?? [],
        scopes: [],
    }

    const schema = introspect(descriptor)
    const outputs = {}

    outputs.model = {
        code: generateModelStub(schema),
        path: resolve(ctx.cwd, cfg.paths.models, `${name}.js`),
    }

    if (args.withMigration) {
        const migName = `create_${table}_table`
        outputs.migration = {
            code: generateMigrationStub(migName, schema),
            path: resolve(ctx.cwd, cfg.paths.migrations, `${migrationTimestamp()}_${migName}.js`),
        }
    }

    if (args.withFactory) {
        outputs.factory = {
            code: generateFactoryStub(schema),
            path: resolve(ctx.cwd, cfg.paths.factories, `${name}Factory.js`),
        }
    }

    if (args.withSeeder) {
        outputs.seeder = {
            code: generateSeederStub(schema),
            path: resolve(ctx.cwd, cfg.paths.seeders, `${name}Seeder.js`),
        }
    }

    if (args.write) {
        for (const [type, { code, path }] of Object.entries(outputs)) {
            ensureDir(resolve(path, '..'))
            writeFileSync(path, code, 'utf8')
        }
    }

    return {
        generated: Object.fromEntries(
            Object.entries(outputs).map(([t, { code, path }]) => [t, { code, path, written: !!args.write }])
        ),
        message: args.write
            ? `Generated ${Object.keys(outputs).length} file(s) for model ${name}.`
            : `Preview generated. Set write: true to save files.`,
    }
}

export async function handleGenerateMigration(args, ctx) {
    const { generateMigrationStub } = await import('@eloquentjs/codegen/templates')
    const { resolveConfig, toSnakeCase, migrationTimestamp } =
        await import('../../../cli/src/utils.js')

    const cfg = resolveConfig(ctx)
    const name = toSnakeCase(args.name)
    const ts = migrationTimestamp()
    const filename = `${ts}_${name}.js`
    const path = resolve(
        ctx.cwd,
        args.migrationsDir ?? cfg.paths.migrations,
        filename
    )

    let schema = null
    if (args.fromModel) {
        const { introspect } = await import('@eloquentjs/codegen/introspect')
        const modelsDir = resolve(ctx.cwd, cfg.paths.models)
        const { loadModelsByName } = await import('@eloquentjs/codegen/render')
        const [ModelClass] = await loadModelsByName(modelsDir, [args.fromModel])
        schema = introspect(ModelClass)
    }

    const code = generateMigrationStub(name, schema)

    if (args.write) {
        ensureDir(resolve(path, '..'))
        writeFileSync(path, code, 'utf8')
    }

    return { code, path, filename, written: !!args.write }
}

export async function handleGenerateGraphqlSchema(args, ctx) {
    const { resolveConfig } = await import('../../../cli/src/utils.js')
    const { introspectAll } = await import('@eloquentjs/codegen/introspect')
    const { generateGraphqlSchema } = await import('@eloquentjs/codegen/templates')
    const { loadModelsFromDir, loadModelsByName } = await import('@eloquentjs/codegen/render')

    const cfg = resolveConfig(ctx)
    const dir = resolve(ctx.cwd, args.modelsDir ?? cfg.paths.models)
    const classes = args.models?.length
        ? await loadModelsByName(dir, args.models)
        : await loadModelsFromDir(dir)

    const schemas = introspectAll(classes)
    const sdl = generateGraphqlSchema(schemas, {
        pagination: args.pagination ?? 'offset',
        subscriptions: args.subscriptions !== false,
    })

    if (args.write) {
        const outPath = resolve(ctx.cwd, args.outputFile ?? 'schema.graphql')
        ensureDir(resolve(outPath, '..'))
        writeFileSync(outPath, sdl, 'utf8')
        return { sdl, path: outPath, written: true, lines: sdl.split('\n').length }
    }

    return { sdl, lines: sdl.split('\n').length }
}

export async function handleGenerateTypeScriptTypes(args, ctx) {
    const { resolveConfig } = await import('../../../cli/src/utils.js')
    const { introspectAll } = await import('@eloquentjs/codegen/introspect')
    const { generateTypeScriptFile } = await import('@eloquentjs/codegen/templates')
    const { loadModelsFromDir, loadModelsByName } = await import('@eloquentjs/codegen/render')

    const cfg = resolveConfig(ctx)
    const dir = resolve(ctx.cwd, args.modelsDir ?? cfg.paths.models)
    const classes = args.models?.length
        ? await loadModelsByName(dir, args.models)
        : await loadModelsFromDir(dir)

    const schemas = introspectAll(classes)
    const ts = generateTypeScriptFile(schemas)

    if (args.write) {
        const outPath = resolve(ctx.cwd, args.outputFile ?? 'src/types/models.d.ts')
        ensureDir(resolve(outPath, '..'))
        writeFileSync(outPath, ts, 'utf8')
        return { types: ts, path: outPath, written: true }
    }

    return { types: ts }
}

export async function handleGenerateOpenApiSpec(args, ctx) {
    const { resolveConfig } = await import('../../../cli/src/utils.js')
    const { introspectAll } = await import('@eloquentjs/codegen/introspect')
    const { generateOpenApiSpec } = await import('@eloquentjs/codegen/templates')
    const { loadModelsFromDir, loadModelsByName } = await import('@eloquentjs/codegen/render')

    const cfg = resolveConfig(ctx)
    const dir = resolve(ctx.cwd, args.modelsDir ?? cfg.paths.models)
    const classes = args.models?.length
        ? await loadModelsByName(dir, args.models)
        : await loadModelsFromDir(dir)

    const schemas = introspectAll(classes)
    const spec = generateOpenApiSpec(schemas, {
        title: args.title ?? 'API',
        version: args.version ?? '0.0.3',
    })

    const format = args.format ?? 'json'
    const content = format === 'yaml' ? toMinimalYaml(spec) : JSON.stringify(spec, null, 2)

    if (args.write) {
        const ext = format === 'yaml' ? 'yaml' : 'json'
        const outPath = resolve(ctx.cwd, args.outputFile ?? `openapi.${ext}`)
        ensureDir(resolve(outPath, '..'))
        writeFileSync(outPath, content, 'utf8')
        return { spec, content, path: outPath, written: true }
    }

    return { spec, content }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function toMinimalYaml(obj, indent = 0) {
    const pad = '  '.repeat(indent)
    if (obj === null) return 'null'
    if (typeof obj === 'boolean') return String(obj)
    if (typeof obj === 'number') return String(obj)
    if (typeof obj === 'string') {
        if (/[:{}\[\],#&*!|>'"%@`\n]/.test(obj) || obj === '') return `"${obj.replace(/"/g, '\\"')}"`
        return obj
    }
    if (Array.isArray(obj)) {
        if (!obj.length) return '[]'
        return '\n' + obj.map(v => `${pad}- ${toMinimalYaml(v, indent + 1).trimStart()}`).join('\n')
    }
    if (typeof obj === 'object') {
        const entries = Object.entries(obj).filter(([, v]) => v !== undefined)
        if (!entries.length) return '{}'
        return '\n' + entries.map(([k, v]) => {
            const val = toMinimalYaml(v, indent + 1)
            return val.startsWith('\n') ? `${pad}${k}:${val}` : `${pad}${k}: ${val}`
        }).join('\n')
    }
    return String(obj)
}
