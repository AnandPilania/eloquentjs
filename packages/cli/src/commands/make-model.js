import { resolve } from 'path'
import {
  colors, success, error,
  toPascalCase, toSnakeCase, toTableName, migrationTimestamp,
  resolveConfig, writeFile, relativeImportPath,
} from '../utils.js'

export async function cmdMakeModel(ctx) {
  const { cwd, flags, positional } = ctx
  const cfg = resolveConfig(ctx)

  const rawName = positional[0] ?? flags.name ?? flags.n
  if (!rawName) {
    error('Model name is required.')
    console.log(`  Usage: ${colors.cyan}eloquent make:model <ModelName>${colors.reset}`)
    process.exit(1)
  }

  const name  = toPascalCase(rawName)
  const table = toTableName(name)

  const descriptor = {
    name, table,
    primaryKey:  'id',
    fillable:    [],
    hidden:      [],
    casts:       {},
    timestamps:  !flags['no-timestamps'],
    softDeletes: !!(flags['soft-deletes'] || flags.s),
    relations:   [],
    scopes:      [],
  }

  // Try codegen, fall back to inline generators
  let gms, gmig, gfact, gseed, intro
  try {
    const stubs = await import('@eloquentjs/codegen/templates')
    const intr  = await import('@eloquentjs/codegen/introspect')
    gms   = stubs.generateModelStub
    gmig  = stubs.generateMigrationStub
    gfact = stubs.generateFactoryStub
    gseed = stubs.generateSeederStub
    intro = intr.introspect
  } catch {
    gms = inlineModel; gmig = inlineMigration
    gfact = inlineFactory; gseed = inlineSeeder
    intro = (d) => d
  }

  const schema = intro(descriptor)

  if (writeFile(resolve(cwd, cfg.paths.models, `${name}.js`), gms(schema), { overwrite: flags.force || flags.f }))
    success(`Model created: ${cfg.paths.models}/${name}.js`)

  if (flags.migration || flags.m || flags.all || flags.a) {
    const migName = `create_${toSnakeCase(table)}_table`
    const fname   = `${migrationTimestamp()}_${migName}.js`
    if (writeFile(resolve(cwd, cfg.paths.migrations, fname), gmig(migName, schema), { overwrite: flags.force || flags.f }))
      success(`Migration created: ${cfg.paths.migrations}/${fname}`)
  }

  if (flags.factory || flags.all || flags.a) {
    const modelsPath = relativeImportPath(resolve(cwd, cfg.paths.factories), resolve(cwd, cfg.paths.models))
    if (writeFile(resolve(cwd, cfg.paths.factories, `${name}Factory.js`), gfact({ ...schema, modelsPath }, { modelsPath }), { overwrite: flags.force || flags.f }))
      success(`Factory created: ${cfg.paths.factories}/${name}Factory.js`)
  }

  if (flags.seed || flags.seeder || flags.all || flags.a) {
    const factoriesPath = relativeImportPath(resolve(cwd, cfg.paths.seeders), resolve(cwd, cfg.paths.factories))
    if (writeFile(resolve(cwd, cfg.paths.seeders, `${name}Seeder.js`), gseed(schema, { factoriesPath }), { overwrite: flags.force || flags.f }))
      success(`Seeder created: ${cfg.paths.seeders}/${name}Seeder.js`)
  }
}

// ─── Inline fallbacks (when @eloquentjs/codegen not installed) ────────────────
function inlineModel({ name, table, softDeletes, timestamps }) {
  const sd = softDeletes ? `\n  static softDeletes = true` : ''
  const ts = timestamps === false ? `\n  static timestamps   = false` : ''
  return `import { Model } from '@eloquentjs/core'\n\nexport default class ${name} extends Model {\n  static table    = '${table}'\n  static fillable = []\n  static hidden   = []${sd}${ts}\n\n  static casts = {}\n  // posts() { return this.hasMany(Post) }\n  // static async creating(record) { }\n}\n`
}
function inlineMigration(name, { table, softDeletes, timestamps }) {
  const cn = name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')
  const sd = softDeletes ? '\n      t.softDeletes()' : ''
  const ts = timestamps !== false ? '\n      t.timestamps()' : ''
  return `import { Migration, Schema } from '@eloquentjs/core'\n\nexport default class ${cn} extends Migration {\n  async up() {\n    await Schema.create('${table}', t => {\n      t.id()\n      // t.string('name')${ts}${sd}\n    })\n  }\n  async down() { await Schema.dropIfExists('${table}') }\n}\n`
}
function inlineFactory({ name, modelsPath = '../models' }) {
  return `import { Factory } from '@eloquentjs/core'\nimport { faker } from '@faker-js/faker'\nimport ${name} from '${modelsPath}/${name}.js'\n\nexport default class ${name}Factory extends Factory {\n  model = ${name}\n  definition() { return { /* name: faker.person.fullName() */ } }\n}\n`
}
function inlineSeeder({ name }) {
  return `import { Seeder } from '@eloquentjs/core'\n\nexport default class ${name}Seeder extends Seeder {\n  async run() {\n    console.log('${name}Seeder done.')\n  }\n}\n`
}
