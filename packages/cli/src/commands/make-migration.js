import { resolve } from 'path'
import {
  colors, success, error,
  toSnakeCase, migrationTimestamp,
  resolveConfig, writeFile,
} from '../utils.js'

export async function cmdMakeMigration(ctx) {
  const { cwd, flags, positional } = ctx
  const cfg = resolveConfig(ctx)

  const rawName = positional[0] ?? flags.name ?? flags.n
  if (!rawName) {
    error('Migration name is required.')
    console.log(`  Usage: ${colors.cyan}eloquent make:migration <name>${colors.reset}`)
    console.log(`  Example: ${colors.cyan}eloquent make:migration create_users_table${colors.reset}`)
    process.exit(1)
  }

  const name      = toSnakeCase(rawName)
  const timestamp = migrationTimestamp()
  const filename  = `${timestamp}_${name}.js`
  const migPath   = resolve(cwd, cfg.paths.migrations, filename)

  // Try codegen stub generator, fall back to inline
  let generateMigrationStub
  try {
    const stubs = await import('@eloquentjs/codegen/templates')
    generateMigrationStub = stubs.generateMigrationStub
  } catch {
    generateMigrationStub = inlineMigration
  }

  const content = generateMigrationStub(name)
  if (writeFile(migPath, content, { overwrite: flags.force || flags.f }))
    success(`Migration created: ${cfg.paths.migrations}/${filename}`)
}

// Inline fallback
function inlineMigration(name) {
  const cn = name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')
  const createMatch = name.match(/^create_(.+?)(?:_table)?$/)
  if (createMatch) {
    const t = createMatch[1]
    return `import { Migration, Schema } from '@eloquentjs/core'\n\nexport default class ${cn} extends Migration {\n  async up() {\n    await Schema.create('${t}', t => {\n      t.id()\n      t.timestamps()\n    })\n  }\n  async down() { await Schema.dropIfExists('${t}') }\n}\n`
  }
  return `import { Migration, Schema } from '@eloquentjs/core'\n\nexport default class ${cn} extends Migration {\n  async up() { /* TODO */ }\n  async down() { /* TODO */ }\n}\n`
}
