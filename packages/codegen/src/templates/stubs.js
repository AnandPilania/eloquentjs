/**
 * @eloquentjs/codegen — Stub Templates
 *
 * Generates JS source stubs for models, migrations, factories, and seeders.
 * Previously inline in the CLI — now shared here so any tool can generate them.
 */

// ─── Model stub ───────────────────────────────────────────────────────────────

/**
 * Generate a Model class stub.
 * @param {import('../introspect.js').ModelSchema} schema — from introspect() or a plain descriptor
 * @param {{importPath?: string, withComments?: boolean}} opts
 * @returns {string}
 */
export function generateModelStub(schema, opts = {}) {
  const {
    importPath = '@eloquentjs/core',
    withComments = true,
  } = opts

  const { name, table, softDeletes, timestamps, fillable, hidden, fields, relations, scopes } = schema

  // Build casts block from the schema's fields (skip id and timestamps)
  const castFields = fields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete && f.cast)
  const castsBlock = castFields.length
    ? castFields.map(f => `    ${f.name}: '${f.cast}',`).join('\n')
    : '    // created_at: \'date\',\n    // is_active:  \'boolean\',\n    // meta:       \'json\','

  const softDeleteLine = softDeletes ? `\n  static softDeletes = true` : ''
  const timestampsLine = timestamps === false ? `\n  static timestamps   = false` : ''

  const fillableLine = fillable.length
    ? `['${fillable.join("', '")}']`
    : '[]'
  const hiddenLine = hidden.length
    ? `['${hidden.join("', '")}']`
    : '[]'

  // Relation stubs
  const relationBlock = relations.length
    ? relations.map(r => `  ${r.name}() { return this.${r.type}(/* ${r.related} */) }`).join('\n')
    : (withComments ? `  // posts()   { return this.hasMany(Post) }\n  // profile() { return this.hasOne(Profile) }` : '')

  // Scope stubs
  const scopeBlock = scopes.length
    ? scopes.map(s => `  static ${s.methodName}(qb) { return qb }`).join('\n')
    : (withComments ? `  // static scopeActive(qb) { return qb.where('active', true) }` : '')

  const comments = withComments ? `
  // ── Accessors / Mutators ─────────────────────────────────────────────
  // getFullNameAttribute() { return \`\${this.first_name} \${this.last_name}\` }
  // setPasswordAttribute(v) { return bcrypt.hashSync(v, 10) }

  // ── Lifecycle Hooks ──────────────────────────────────────────────────
  // static async creating(record) { }
  // static async created(record)  { }
  // static async updating(record) { }
  // static async updated(record)  { }
  // static async deleting(record) { }
  // static async deleted(record)  { }` : ''

  return `import { Model } from '${importPath}'

export default class ${name} extends Model {
  static table    = '${table}'
  static fillable = ${fillableLine}
  static hidden   = ${hiddenLine}${softDeleteLine}${timestampsLine}

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
${castsBlock}
  }

  // ── Relations ────────────────────────────────────────────────────────
${relationBlock}

  // ── Scopes ───────────────────────────────────────────────────────────
${scopeBlock}
${comments}
}
`
}

// ─── Migration stub ───────────────────────────────────────────────────────────

/**
 * Generate a migration stub — either a smart template or from a full schema.
 * @param {string} name — snake_case migration name
 * @param {import('../introspect.js').ModelSchema|null} schema — optional; when provided generates columns from casts
 * @param {Record<string, any>} opts
 * @returns {string}
 */
export function generateMigrationStub(name, schema = null, opts = {}) {
  const className = name.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('')

  if (schema) {
    return generateMigrationFromSchema(className, schema, opts)
  }

  // Smart template detection (same logic as CLI make:migration)
  const createMatch = name.match(/^create_(.+?)(?:_table)?$/)
  if (createMatch) return generateCreateMigration(className, createMatch[1])

  const addMatch = name.match(/^add_(.+?)_to_(.+?)(?:_table)?$/)
  if (addMatch) return generateAddColumnMigration(className, addMatch[2], addMatch[1])

  const dropColMatch = name.match(/^drop_(.+?)_from_(.+?)(?:_table)?$/)
  if (dropColMatch) return generateDropColumnMigration(className, dropColMatch[2], dropColMatch[1])

  const renameMatch = name.match(/^rename_(.+?)_to_(.+)$/)
  if (renameMatch) return generateRenameTableMigration(className, renameMatch[1], renameMatch[2])

  const dropMatch = name.match(/^drop_(.+?)(?:_table)?$/)
  if (dropMatch) return generateDropMigration(className, dropMatch[1])

  return generateGenericMigration(className)
}

function castToColumnCall(field) {
  const { name, cast } = field
  const base = cast?.split(':')[0].toLowerCase() ?? 'string'
  const precision = cast?.includes(':') ? parseInt(cast.split(':')[1]) : null

  const colCalls = {
    integer:    `t.integer('${name}')`,
    biginteger: `t.bigInteger('${name}')`,
    float:      `t.float('${name}')`,
    double:     `t.double('${name}')`,
    decimal:    precision ? `t.decimal('${name}', 8, ${precision})` : `t.decimal('${name}')`,
    string:     `t.string('${name}')`,
    text:       `t.text('${name}')`,
    boolean:    `t.boolean('${name}').default(false)`,
    date:       `t.date('${name}')`,
    datetime:   `t.timestamp('${name}')`,
    timestamp:  `t.timestamp('${name}')`,
    json:       `t.json('${name}')`,
    jsonb:      `t.jsonb('${name}')`,
    array:      `t.json('${name}')`,
    uuid:       `t.uuid('${name}')`,
  }

  const call = colCalls[base] ?? `t.string('${name}')`
  const nullable = field.nullable !== false ? '.nullable()' : ''
  return `      ${call}${nullable}`
}

function generateMigrationFromSchema(className, schema, opts = {}) {
  const { table, fields, softDeletes, timestamps } = schema
  const dataFields = fields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete)

  const columnLines = dataFields.map(castToColumnCall)
  if (timestamps) {
    columnLines.push(`      t.timestamps()`)
  }
  if (softDeletes) {
    columnLines.push(`      t.softDeletes()`)
  }

  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    await Schema.create('${table}', t => {
      t.id()
${columnLines.join('\n')}
    })
  }

  async down() {
    await Schema.dropIfExists('${table}')
  }
}
`
}

function generateCreateMigration(className, table) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    await Schema.create('${table}', t => {
      t.id()
      // t.string('name')
      // t.string('email').unique()
      // t.text('body').nullable()
      // t.boolean('is_active').default(true)
      // t.foreignId('user_id').constrained('users')
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('${table}')
  }
}
`
}

function generateAddColumnMigration(className, table, columns) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    await Schema.table('${table}', t => {
      // t.string('${columns}').nullable()
    })
  }

  async down() {
    await Schema.table('${table}', t => {
      // t.dropColumn('${columns}')
    })
  }
}
`
}

function generateDropColumnMigration(className, table, columns) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    await Schema.table('${table}', t => {
      t.dropColumn('${columns}')
    })
  }

  async down() {
    await Schema.table('${table}', t => {
      // t.string('${columns}').nullable()
    })
  }
}
`
}

function generateRenameTableMigration(className, from, to) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up()   { await Schema.rename('${from}', '${to}') }
  async down() { await Schema.rename('${to}', '${from}') }
}
`
}

function generateDropMigration(className, table) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    await Schema.dropIfExists('${table}')
  }

  async down() {
    await Schema.create('${table}', t => {
      t.id()
      t.timestamps()
    })
  }
}
`
}

function generateGenericMigration(className) {
  return `import { Migration, Schema } from '@eloquentjs/core'

export default class ${className} extends Migration {
  async up() {
    // Write your migration here
  }

  async down() {
    // Reverse the migration
  }
}
`
}

// ─── Factory stub ─────────────────────────────────────────────────────────────

export function generateFactoryStub(schema, opts = {}) {
  const { name, fields } = schema
  const { modelsPath = '../models' } = opts

  const fakerLines = fields
    .filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete && !f.hidden)
    .map(f => {
      const hint = fakerHint(f)
      return hint ? `      // ${f.name}: ${hint},` : null
    })
    .filter(Boolean)

  return `import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import ${name} from '${modelsPath}/${name}.js'

export default class ${name}Factory extends Factory {
  model = ${name}

  definition() {
    return {
${fakerLines.join('\n') || '      //'}
    }
  }

  // States:
  // admin() { return this.state({ is_admin: true }) }
}
`
}

function fakerHint(field) {
  const n = field.name.toLowerCase()
  if (n === 'name' || n === 'full_name')       return 'faker.person.fullName()'
  if (n === 'first_name')                       return 'faker.person.firstName()'
  if (n === 'last_name')                        return 'faker.person.lastName()'
  if (n === 'email')                            return 'faker.internet.email()'
  if (n === 'username')                         return 'faker.internet.username()'
  if (n === 'password')                         return "'password'"
  if (n === 'phone' || n === 'phone_number')    return 'faker.phone.number()'
  if (n === 'title')                            return 'faker.lorem.sentence()'
  if (n === 'body' || n === 'content')          return 'faker.lorem.paragraphs(2)'
  if (n === 'bio' || n === 'description')       return 'faker.lorem.paragraph()'
  if (n === 'slug')                             return 'faker.helpers.slugify(faker.lorem.words(3))'
  if (n === 'url' || n === 'website')           return 'faker.internet.url()'
  if (n === 'avatar' || n === 'avatar_url')     return 'faker.image.avatar()'
  if (n === 'address')                          return 'faker.location.streetAddress()'
  if (n === 'city')                             return 'faker.location.city()'
  if (n === 'country')                          return 'faker.location.country()'
  if (n === 'zip' || n === 'postal_code')       return 'faker.location.zipCode()'
  if (n.includes('is_') || n.startsWith('has_')) return 'faker.datatype.boolean()'
  if (field.tsType === 'number')                return 'faker.number.int({ min: 1, max: 100 })'
  if (field.tsType === 'Date')                  return 'faker.date.recent()'
  return null
}

// ─── Seeder stub ──────────────────────────────────────────────────────────────

export function generateSeederStub(schema, opts = {}) {
  const { name } = schema
  const { factoriesPath = '../factories' } = opts

  return `import { Seeder } from '@eloquentjs/core'
import ${name}Factory from '${factoriesPath}/${name}Factory.js'

export default class ${name}Seeder extends Seeder {
  async run() {
    await ${name}Factory.new().count(10).create()
    console.log('${name}Seeder done.')
  }
}
`
}
