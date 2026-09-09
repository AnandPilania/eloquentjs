/**
 * @eloquentjs/codegen — TypeScript Types Template
 *
 * Generates TypeScript interfaces and types from ModelSchemas.
 * CLI: eloquent generate:types
 */

/**
 * Generate TypeScript interface + helper types for one model.
 * @param {import('../introspect.js').ModelSchema} schema
 * @param {{includeRelations?: boolean, includeCreateInput?: boolean, includeUpdateInput?: boolean, includeWhereInput?: boolean, strict?: boolean}} opts
 * @returns {string}
 */
export function generateTypeScriptTypes(schema, opts = {}) {
  const {
    includeRelations    = true,
    includeCreateInput  = true,
    includeUpdateInput  = true,
    includeWhereInput   = false,
    strict              = true,
  } = opts

  const { name, fields, relations } = schema

  const lines = []

  // ── Main interface ────────────────────────────────────────────────────────
  lines.push(`export interface ${name} {`)
  for (const f of fields) {
    // `strict: false` marks every property optional; otherwise only nullable
    // columns and the auto-managed timestamp columns are.
    const optional = !strict || f.nullable || f.isTimestamp || f.isSoftDelete ? '?' : ''
    // The PK's type comes from introspection (keyType), not a hard-coded string.
    lines.push(`  ${f.name}${optional}: ${f.tsType}`)
  }

  if (includeRelations) {
    for (const rel of relations) {
      const relType = rel.isList ? `${rel.related}[]` : rel.related
      lines.push(`  ${rel.name}?: ${relType} | null`)
    }
  }
  lines.push('}', '')

  // ── CreateInput ───────────────────────────────────────────────────────────
  if (includeCreateInput) {
    const inputFields = fields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete && !f.hidden)
    lines.push(`export interface Create${name}Input {`)
    for (const f of inputFields) {
      lines.push(`  ${f.name}?: ${f.tsType}`)
    }
    lines.push('}', '')
  }

  // ── UpdateInput ───────────────────────────────────────────────────────────
  if (includeUpdateInput) {
    const inputFields = fields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete && !f.hidden)
    lines.push(`export interface Update${name}Input {`)
    for (const f of inputFields) {
      lines.push(`  ${f.name}?: ${f.tsType}`)
    }
    lines.push('}', '')
  }

  // ── WhereInput ────────────────────────────────────────────────────────────
  if (includeWhereInput) {
    lines.push(`export interface ${name}WhereInput {`)
    for (const f of fields) {
      lines.push(`  ${f.name}?: ${f.tsType} | null`)
    }
    lines.push(`  AND?: ${name}WhereInput[]`)
    lines.push(`  OR?: ${name}WhereInput[]`)
    lines.push('}', '')
  }

  return lines.join('\n')
}

/**
 * Generate a `declare module` augmentation that merges a model's columns and
 * typed statics directly onto its own source file — so `import User from
 * './User.js'; user.name` and `User.create({...})` are checked against the
 * live schema with no hand-written types and no generic ceremony at the call
 * site. This is what ties the generated types into the query builder:
 * `QueryBuilder<typeof User>` already exists in core, it's just never been
 * surfaced back onto the model class itself.
 *
 * @param {import('../introspect.js').ModelSchema} schema
 * @param {{modelImportPath?: string, coreImportPath?: string}} opts
 *   modelImportPath: the module specifier TS should augment — defaults to
 *   `./${name}.js` (the model's own file, resolved relative to the output
 *   file's directory).
 * @returns {string}
 */
export function generateModelAugmentation(schema, opts = {}) {
  const { name, fields } = schema
  const {
    modelImportPath = `./${name}.js`,
    coreImportPath = '@eloquentjs/core',
  } = opts

  const attrFields = fields.filter(f => !f.isPk)
  const pk = fields.find(f => f.isPk)
  const inputFields = fields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete && !f.hidden)

  const lines = []
  lines.push(`import type { Model, QueryBuilder } from '${coreImportPath}'`)
  lines.push('')
  lines.push(`declare module '${modelImportPath}' {`)
  lines.push(`  interface ${name} {`)
  for (const f of attrFields) lines.push(`    ${f.name}${f.nullable ? '?' : ''}: ${f.tsType}`)
  lines.push('  }')
  lines.push(`  class ${name} extends Model {`)
  if (pk) lines.push(`    static readonly primaryKey: '${pk.name}'`)
  lines.push(`    static query(): QueryBuilder<typeof ${name}>`)
  lines.push(`    static find(id: ${pk?.tsType ?? 'string | number'}): Promise<${name} | null>`)
  lines.push(`    static create(attrs: {`)
  for (const f of inputFields) lines.push(`      ${f.name}?: ${f.tsType}`)
  lines.push(`    }): Promise<${name}>`)
  lines.push('  }')
  lines.push('  export default ' + name)
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Generate a complete TypeScript declaration file for one or more models.
 * @param {import('../introspect.js').ModelSchema[]} schemas
 * @param {{header?: boolean, moduleFormat?: 'esm'|'cjs', includeRelations?: boolean, includeCreateInput?: boolean, includeUpdateInput?: boolean, includeWhereInput?: boolean, strict?: boolean}} opts
 * @returns {string}
 */
export function generateTypeScriptFile(schemas, opts = {}) {
  const { header = true } = opts
  const lines = []

  if (header) {
    lines.push('// Auto-generated by @eloquentjs/codegen')
    lines.push(`// Generated: ${new Date().toISOString()}`)
    lines.push('// Do not edit manually — re-run: eloquent generate:types')
    lines.push('')
  }

  // Shared pagination types
  lines.push('export interface PaginationMeta {')
  lines.push('  total: number')
  lines.push('  per_page: number')
  lines.push('  current_page: number')
  lines.push('  last_page: number')
  lines.push('  has_more: boolean')
  lines.push('}')
  lines.push('')
  lines.push('export interface PaginatedResult<T> {')
  lines.push('  data: T[]')
  lines.push('  meta: PaginationMeta')
  lines.push('}')
  lines.push('')

  for (const schema of schemas) {
    lines.push(`// ─── ${schema.name} ${'─'.repeat(60 - schema.name.length)}`)
    lines.push(generateTypeScriptTypes(schema, opts))
  }

  return lines.join('\n')
}
