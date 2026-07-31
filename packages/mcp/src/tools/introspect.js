/**
 * MCP Tools — Schema & Model Introspection
 *
 * Lets AI agents understand the database schema, existing models,
 * and relationships without reading source files manually.
 */

import { existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { pathToFileURL } from 'node:url'

// ─── Tool definitions ──────────────────────────────────────────────────────────

export const introspectTools = [
  {
    name: 'list_models',
    description: 'List all EloquentJS model files in the project. Returns model names, file paths, table names, fillable fields, casts, and relationships.',
    inputSchema: {
      type: 'object',
      properties: {
        modelsDir: {
          type: 'string',
          description: 'Path to models directory. Defaults to the configured models path from eloquent.config.js.',
        },
      },
    },
  },
  {
    name: 'describe_model',
    description: 'Get detailed information about a specific model: fields with their types, relationships, scopes, hooks, fillable/hidden/casts config.',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: 'Model class name (e.g. "User") or file path.',
        },
        modelsDir: { type: 'string' },
      },
      required: ['model'],
    },
  },
  {
    name: 'list_migrations',
    description: 'List all migration files, showing which have run and which are pending. Includes batch numbers and timestamps.',
    inputSchema: {
      type: 'object',
      properties: {
        migrationsDir: { type: 'string' },
      },
    },
  },
  {
    name: 'describe_database_schema',
    description: 'Introspect the live database schema: all tables, columns (with types, nullable, defaults), indexes, and foreign keys. Requires a database connection.',
    inputSchema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'Specific table to describe. If omitted, describes all tables.',
        },
        connection: { type: 'string', default: 'default' },
      },
    },
  },
  {
    name: 'get_project_structure',
    description: 'Get an overview of the EloquentJS project structure: config, packages installed, model count, migration count, seeder count.',
    inputSchema: { type: 'object', properties: {} },
  },
]

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleListModels(args, ctx) {
  const dir = args.modelsDir
    ? resolve(args.modelsDir)
    : resolve(ctx.cwd, ctx.config?.paths?.models ?? 'app/models')

  if (!existsSync(dir)) {
    return { models: [], message: `Models directory not found: ${dir}` }
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  const models = []

  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, file)).href)
      const ModelClass = mod.default
      if (!ModelClass || typeof ModelClass !== 'function') continue

      const { introspect } = await import('@eloquentjs/codegen/introspect')
      const schema = introspect(ModelClass)

      models.push({
        name:       schema.name,
        file:       join(dir, file),
        table:      schema.table,
        primaryKey: schema.primaryKey,
        softDeletes: schema.softDeletes,
        fillable:   schema.fillable,
        hidden:     schema.hidden,
        casts:      Object.fromEntries(schema.fields.filter(f => !f.isPk && !f.isTimestamp).map(f => [f.name, f.cast])),
        relations:  schema.relations.map(r => ({ name: r.name, type: r.type, related: r.related, isList: r.isList })),
        scopes:     schema.scopes.map(s => s.name),
        fieldCount: schema.fields.length,
      })
    } catch (err) {
      models.push({ name: file.replace('.js', ''), file: join(dir, file), error: err.message })
    }
  }

  return { models, total: models.length, directory: dir }
}

export async function handleDescribeModel(args, ctx) {
  const dir = args.modelsDir
    ? resolve(args.modelsDir)
    : resolve(ctx.cwd, ctx.config?.paths?.models ?? 'app/models')

  const modelName = args.model.replace('.js', '')
  const filePath  = existsSync(args.model)
    ? resolve(args.model)
    : resolve(dir, `${modelName}.js`)

  if (!existsSync(filePath)) {
    throw new Error(`Model file not found: ${filePath}`)
  }

  const mod = await import(pathToFileURL(filePath).href)
  const ModelClass = mod.default
  if (!ModelClass) throw new Error(`No default export in ${filePath}`)

  const { introspect } = await import('@eloquentjs/codegen/introspect')
  const schema = introspect(ModelClass)

  return {
    name:        schema.name,
    table:       schema.table,
    primaryKey:  schema.primaryKey,
    softDeletes: schema.softDeletes,
    timestamps:  schema.timestamps,
    fillable:    schema.fillable,
    hidden:      schema.hidden,
    fields: schema.fields.map(f => ({
      name:       f.name,
      cast:       f.cast,
      jsType:     f.jsType,
      gqlType:    f.gqlType,
      tsType:     f.tsType,
      nullable:   f.nullable,
      fillable:   f.fillable,
      hidden:     f.hidden,
      isPk:       f.isPk,
      isTimestamp: f.isTimestamp,
      isSoftDelete: f.isSoftDelete,
    })),
    relations: schema.relations.map(r => ({
      name:         r.name,
      type:         r.type,
      related:      r.related,
      isList:       r.isList,
      isPolymorphic: r.isPolymorphic,
    })),
    scopes: schema.scopes.map(s => ({ name: s.name, method: s.methodName })),
    graphql: {
      hiddenFields:  [...schema.graphql.hidden],
      disabledOps:   Object.keys(schema.graphql.disabled),
      subscription:  schema.graphql.subscription,
    },
  }
}

export async function handleListMigrations(args, ctx) {
  const { scanMigrations, resolveConfig } = await import('@eloquentjs/cli/utils')
  const cfg = resolveConfig(ctx)
  const dir = args.migrationsDir
    ? resolve(args.migrationsDir)
    : resolve(ctx.cwd, cfg.paths.migrations)

  const allFiles = scanMigrations(dir)

  // Try to read run status from DB
  let ranMap = new Map()
  try {
    const conn = await (await import('@eloquentjs/cli/utils')).loadConnection(ctx)
    const rows = await conn.raw('SELECT migration, batch, ran_at FROM _migrations ORDER BY id ASC').catch(() => [])
    const data = rows.rows ?? rows
    for (const r of data) ranMap.set(r.migration, { batch: r.batch, ranAt: r.ran_at })
  } catch { /* DB may not be connected — show files only */ }

  return {
    migrations: allFiles.map(f => ({
      filename: f.filename,
      name:     f.name,
      ran:      ranMap.has(f.filename),
      batch:    ranMap.get(f.filename)?.batch ?? null,
      ranAt:    ranMap.get(f.filename)?.ranAt ?? null,
    })),
    total:   allFiles.length,
    ran:     allFiles.filter(f => ranMap.has(f.filename)).length,
    pending: allFiles.filter(f => !ranMap.has(f.filename)).length,
    directory: dir,
  }
}

export async function handleDescribeDatabaseSchema(args, ctx) {
  const { loadConnection } = await import('@eloquentjs/cli/utils')
  const conn = await loadConnection(ctx)

  if (args.table) {
    // Describe single table
    const columns = await conn.raw(`
      SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [args.table]).then(r => r.rows ?? r)

    const indexes = await conn.raw(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1
    `, [args.table]).then(r => r.rows ?? r)

    const foreignKeys = await conn.raw(`
      SELECT
        kcu.column_name,
        ccu.table_name  AS foreign_table,
        ccu.column_name AS foreign_column,
        rc.delete_rule, rc.update_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
    `, [args.table]).then(r => r.rows ?? r)

    return { table: args.table, columns, indexes, foreignKeys }
  }

  // Describe all tables
  const tables = await conn.raw(`
    SELECT tablename, pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) AS size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `).then(r => r.rows ?? r)

  return {
    tables: tables.map(t => t.tablename),
    sizes:  Object.fromEntries(tables.map(t => [t.tablename, t.size])),
    total:  tables.length,
  }
}

export async function handleGetProjectStructure(args, ctx) {
  const { resolveConfig } = await import('@eloquentjs/cli/utils')
  const cfg = resolveConfig(ctx)

  const count = (dir) => {
    if (!existsSync(dir)) return 0
    return readdirSync(dir).filter(f => f.endsWith('.js')).length
  }

  const installedPackages = []
  const pkgJsonPath = resolve(ctx.cwd, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse((await import('fs')).readFileSync(pkgJsonPath, 'utf8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name] of Object.entries(deps)) {
      if (name.startsWith('@eloquentjs/')) installedPackages.push(name)
    }
  }

  return {
    cwd:      ctx.cwd,
    config:   existsSync(resolve(ctx.cwd, 'eloquent.config.js')) ? 'eloquent.config.js' : null,
    paths:    cfg.paths,
    counts: {
      models:     count(resolve(ctx.cwd, cfg.paths.models)),
      migrations: count(resolve(ctx.cwd, cfg.paths.migrations)),
      seeders:    count(resolve(ctx.cwd, cfg.paths.seeders)),
      factories:  count(resolve(ctx.cwd, cfg.paths.factories)),
    },
    installedPackages,
    connection: { driver: cfg.connection?.driver ?? 'unknown' },
  }
}
