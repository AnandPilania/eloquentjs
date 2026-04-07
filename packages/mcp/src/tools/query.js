/**
 * MCP Tools — Query Execution & Migration Tools
 *
 * Lets AI agents run queries, execute migrations, and seed data
 * directly against the configured database.
 */

// ─── Tool definitions ──────────────────────────────────────────────────────────

export const queryTools = [
  {
    name: 'query_model',
    description: 'Run a query against a model and return results. Supports where, orderBy, limit, with (eager loading), and count operations. Safe — only SELECT queries. Results capped at 100 rows.',
    inputSchema: {
      type: 'object',
      properties: {
        model:   { type: 'string', description: 'Model class name (e.g. "User").' },
        where:   { type: 'object', description: 'WHERE conditions as { field: value } or { field: [operator, value] }.' },
        orderBy: { type: 'string', description: 'Field to order by.' },
        order:   { type: 'string', enum: ['asc', 'desc'], default: 'asc' },
        limit:   { type: 'integer', default: 25 },
        offset:  { type: 'integer', default: 0 },
        with:    { type: 'array', items: { type: 'string' }, description: 'Relations to eager-load.' },
        count:   { type: 'boolean', default: false, description: 'Return count instead of rows.' },
        modelsDir: { type: 'string' },
      },
      required: ['model'],
    },
  },
  {
    name: 'run_raw_query',
    description: 'Execute a raw SQL SELECT query. Only SELECT statements are allowed for safety.',
    inputSchema: {
      type: 'object',
      properties: {
        sql:        { type: 'string', description: 'SQL SELECT statement.' },
        params:     { type: 'array',  description: 'Query parameters ($1, $2, ...).' },
        connection: { type: 'string', default: 'default' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'run_migrations',
    description: 'Run all pending database migrations.',
    inputSchema: {
      type: 'object',
      properties: {
        dryRun:        { type: 'boolean', default: false, description: 'Preview without executing.' },
        migrationsDir: { type: 'string' },
      },
    },
  },
  {
    name: 'rollback_migration',
    description: 'Rollback the last batch of migrations (or N batches with step).',
    inputSchema: {
      type: 'object',
      properties: {
        step: { type: 'integer', default: 1 },
      },
    },
  },
  {
    name: 'migration_status',
    description: 'Get the current status of all migrations — which have run, which are pending, batch numbers.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_seeder',
    description: 'Run a database seeder class.',
    inputSchema: {
      type: 'object',
      properties: {
        seeder: { type: 'string', default: 'DatabaseSeeder', description: 'Seeder class name.' },
      },
    },
  },
]

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleQueryModel(args, ctx) {
  const { resolveConfig } = await import('../../../cli/src/utils.js')
  const cfg = resolveConfig(ctx)
  const dir = resolve_dir(ctx.cwd, args.modelsDir ?? cfg.paths.models)

  const { loadModelsByName } = await import('@eloquentjs/codegen/render')
  const [ModelClass] = await loadModelsByName(dir, [args.model])

  let qb = ModelClass.query()

  // Apply WHERE conditions
  if (args.where) {
    for (const [field, val] of Object.entries(args.where)) {
      if (Array.isArray(val)) {
        qb = qb.where(field, val[0], val[1])
      } else {
        qb = qb.where(field, val)
      }
    }
  }

  if (args.count) {
    const total = await qb.count()
    return { count: total, model: args.model }
  }

  if (args.orderBy) qb = qb.orderBy(args.orderBy, args.order ?? 'asc')
  if (args.limit)   qb = qb.limit(Math.min(args.limit, 100))  // cap at 100 for safety
  if (args.offset)  qb = qb.offset(args.offset)
  if (args.with?.length) qb = qb.with(...args.with)

  const rows = await qb.get()
  const data = rows.toArray ? rows.toArray() : (Array.isArray(rows) ? rows : [rows])

  return {
    data:  data.map(r => r.toJSON ? r.toJSON() : r),
    count: data.length,
    model: args.model,
  }
}

export async function handleRunRawQuery(args, ctx) {
  // Safety: only allow SELECT statements
  const trimmed = args.sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('EXPLAIN')) {
    throw new Error('Only SELECT, WITH, and EXPLAIN queries are allowed for safety. Use run_migrations for schema changes.')
  }

  const { loadConnection } = await import('../../../cli/src/utils.js')
  const conn = await loadConnection(ctx)
  const rows = await conn.raw(args.sql, args.params ?? [])
  const data = rows.rows ?? rows

  return { rows: data, count: data.length }
}

export async function handleRunMigrations(args, ctx) {
  if (args.dryRun) {
    // List pending without running
    const { scanMigrations, resolveConfig, loadConnection } = await import('../../../cli/src/utils.js')
    const cfg = resolveConfig(ctx)
    const { resolve } = await import('path')
    const migrationsDir = resolve(ctx.cwd, cfg.paths.migrations)
    const files = scanMigrations(migrationsDir)

    const conn = await loadConnection(ctx).catch(() => null)
    let ranNames = new Set()
    if (conn) {
      const rows = await conn.raw('SELECT migration FROM _migrations').catch(() => ({ rows: [] }))
      const data = rows.rows ?? rows
      ranNames = new Set(data.map(r => r.migration))
    }

    const pending = files.filter(f => !ranNames.has(f.filename))
    return {
      dryRun:  true,
      pending: pending.map(f => f.filename),
      total:   pending.length,
      message: `${pending.length} migration(s) would run.`,
    }
  }

  // Actually run migrations
  const { runMigrations } = await import('../../../cli/src/commands/migration-runner.js')
  const { ran, batch } = await runMigrations(ctx)
  return { ran, batch, message: ran > 0 ? `Ran ${ran} migration(s) (batch ${batch}).` : 'Nothing to migrate.' }
}

export async function handleRollbackMigration(args, ctx) {
  const { rollbackMigrations } = await import('../../../cli/src/commands/migration-runner.js')
  const { rolledBack } = await rollbackMigrations(ctx, { step: args.step ?? 1 })
  return { rolledBack, message: `Rolled back ${rolledBack} migration(s).` }
}

export async function handleMigrationStatus(args, ctx) {
  const { getMigrationStatus } = await import('../../../cli/src/commands/migration-runner.js')
  const migrations = await getMigrationStatus(ctx)
  return {
    migrations,
    summary: {
      total:   migrations.length,
      ran:     migrations.filter(m => m.ran).length,
      pending: migrations.filter(m => !m.ran).length,
    },
  }
}

export async function handleRunSeeder(args, ctx) {
  const { resolveConfig, loadConnection } = await import('../../../cli/src/utils.js')
  const { resolve } = await import('path')
  const cfg        = resolveConfig(ctx)
  const className  = args.seeder ?? 'DatabaseSeeder'
  const seederPath = resolve(ctx.cwd, cfg.paths.seeders, `${className}.js`)

  if (!(await import('fs')).existsSync(seederPath)) {
    throw new Error(`Seeder not found: ${seederPath}`)
  }

  await loadConnection(ctx)
  const mod = await import(seederPath)
  const SeederClass = mod.default
  const seeder = new SeederClass()
  await seeder.run()

  return { seeder: className, message: `${className} completed successfully.` }
}

// ─── Util ─────────────────────────────────────────────────────────────────────
function resolve_dir(cwd, path) {
  const { resolve } = require
  return path.startsWith('/') ? path : `${cwd}/${path}`
}
