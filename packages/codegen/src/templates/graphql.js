/**
 * @eloquentjs/codegen — GraphQL SDL Template
 *
 * Generates GraphQL SDL (Schema Definition Language) strings from a ModelSchema.
 * Used by both:
 *   - @eloquentjs/graphql  (runtime schema generation from live classes)
 *   - @eloquentjs/cli      (eloquent generate:graphql — writes .graphql files)
 */

import { toSnakePlural, toCamelCase } from '@eloquentjs/core'

/**
 * Generate full GraphQL SDL for one model.
 * @param {import('../introspect.js').ModelSchema} schema
 * @param {{pagination?: 'offset'|'relay', subscriptions?: boolean, knownTypes?: Set<string>}} opts
 *   `knownTypes` — model names that will actually get a `type` in the final
 *   document. When given, a relation whose related model isn't in it is
 *   dropped instead of emitting a field that points at an undefined type —
 *   generating SDL for a subset of an app's models (as the README's own
 *   `buildSchema([User, Post, Comment])` example does) would otherwise
 *   produce a schema `buildSchema()`/`makeExecutableSchema()` reject outright
 *   the moment any one of those models has a relation to a model outside the
 *   subset.
 * @returns {{ typeDef: string, inputCreate: string, inputUpdate: string, inputWhere: string, paginated: string, queryLines: string[], mutationLines: string[], subscriptionLines: string[] }}
 */
export function generateGraphqlSDL(schema, opts = {}) {
  const {
    pagination    = 'offset',   // 'offset' | 'relay'
    subscriptions = true,
    knownTypes    = null,
  } = opts

  const { name, fields, relations, softDeletes, graphql: gql } = schema
  const singular = lcFirst(name)
  // Core's pluraliser, so the SDL, the runtime resolvers and the REST routes
  // agree — `singular + 's'` produced `categorys`.
  const plural   = toCamelCase(toSnakePlural(name))

  // ── Visible fields (respecting graphql.hidden) ───────────────────────────
  const visibleFields = fields.filter(f => !gql.hidden.has(f.name))

  // ── type <Name> ──────────────────────────────────────────────────────────
  const typeFields = visibleFields.map(f => {
    const gqlType = f.isPk ? 'ID' : f.gqlType
    const bang    = !f.nullable && !f.isPk ? '!' : ''
    return `  ${f.name}: ${gqlType}${bang}`
  })

  // Add relation fields to the type
  for (const rel of relations) {
    if (rel.isPolymorphic) continue // polymorphic needs custom handling
    if (knownTypes && !knownTypes.has(rel.related)) continue
    const gqlRelType = rel.isList ? `[${rel.related}!]` : rel.related
    typeFields.push(`  ${rel.name}: ${gqlRelType}`)
  }

  const typeDef = `type ${name} {\n${typeFields.join('\n')}\n}`

  // ── input Create<Name>Input ──────────────────────────────────────────────
  const inputFields = visibleFields.filter(f => !f.isPk && !f.isTimestamp && !f.isSoftDelete)
  const inputCreate = `input Create${name}Input {\n${
    inputFields.map(f => `  ${f.name}: ${f.gqlType}`).join('\n')
  }\n}`

  // ── input Update<Name>Input ──────────────────────────────────────────────
  const inputUpdate = `input Update${name}Input {\n${
    inputFields.map(f => `  ${f.name}: ${f.gqlType}`).join('\n')
  }\n}`

  // ── input <Name>WhereInput ───────────────────────────────────────────────
  const whereFields = visibleFields
    .map(f => `  ${f.name}: ${f.isPk ? 'ID' : f.gqlType}`)
    .join('\n')
  const inputWhere = `input ${name}WhereInput {\n${whereFields}\n  AND: [${name}WhereInput]\n  OR: [${name}WhereInput]\n}`

  // ── Pagination type ───────────────────────────────────────────────────────
  let paginated
  if (pagination === 'relay') {
    paginated = [
      `type ${name}Edge { node: ${name}!  cursor: String! }`,
      `type ${name}Connection {\n  edges: [${name}Edge!]!\n  pageInfo: PageInfo!\n  totalCount: Int!\n}`,
    ].join('\n')
  } else {
    paginated = `type ${name}Page {\n  data: [${name}!]!\n  meta: PaginationMeta!\n}`
  }

  const listReturn = pagination === 'relay' ? `${name}Connection!` : `${name}Page!`

  // ── Query fields ──────────────────────────────────────────────────────────
  const queryLines = []
  if (!gql.disabled[`${singular}`])
    queryLines.push(`  ${singular}(id: ID!): ${name}`)
  if (!gql.disabled[plural])
    queryLines.push(`  ${plural}(where: ${name}WhereInput, orderBy: String, orderDir: String, page: Int, perPage: Int): ${listReturn}`)
  if (!gql.disabled[`${plural}Count`])
    queryLines.push(`  ${plural}Count(where: ${name}WhereInput): Int!`)

  // ── Mutation fields ───────────────────────────────────────────────────────
  const mutationLines = []
  if (!gql.disabled[`create${name}`])
    mutationLines.push(`  create${name}(input: Create${name}Input!): ${name}!`)
  if (!gql.disabled[`update${name}`])
    mutationLines.push(`  update${name}(id: ID!, input: Update${name}Input!): ${name}!`)
  if (!gql.disabled[`delete${name}`])
    mutationLines.push(`  delete${name}(id: ID!): Boolean!`)
  if (!gql.disabled[`upsert${name}`])
    mutationLines.push(`  upsert${name}(where: ${name}WhereInput!, input: Create${name}Input!): ${name}!`)

  if (softDeletes) {
    if (!gql.disabled[`restore${name}`])
      mutationLines.push(`  restore${name}(id: ID!): ${name}!`)
    if (!gql.disabled[`forceDelete${name}`])
      mutationLines.push(`  forceDelete${name}(id: ID!): Boolean!`)
  }

  // ── Subscription fields ───────────────────────────────────────────────────
  const subscriptionLines = []
  if (subscriptions && gql.subscription !== false) {
    subscriptionLines.push(`  ${singular}Created: ${name}!`)
    subscriptionLines.push(`  ${singular}Updated: ${name}!`)
    subscriptionLines.push(`  ${singular}Deleted: ID!`)
  }

  return {
    typeDef,
    inputCreate,
    inputUpdate,
    inputWhere,
    paginated,
    queryLines,
    mutationLines,
    subscriptionLines,
  }
}

/**
 * Generate a complete standalone .graphql schema file for one or more models.
 * @param {import('../introspect.js').ModelSchema[]} schemas
 * @param {{pagination?: 'offset'|'relay', subscriptions?: boolean, scalars?: string[], header?: boolean}} opts
 * @returns {string} — complete SDL string ready to write to a .graphql file
 */
export function generateGraphqlSchema(schemas, opts = {}) {
  const {
    pagination    = 'offset',
    subscriptions = true,
    scalars       = [],
    header        = true,
  } = opts

  const lines = []

  if (header) {
    lines.push('# Auto-generated by @eloquentjs/codegen')
    lines.push(`# Generated: ${new Date().toISOString()}`)
    lines.push('# Do not edit manually — re-run: eloquent generate:graphql')
    lines.push('')
  }

  // Scalars
  lines.push('scalar JSON')
  lines.push('scalar DateTime')
  lines.push('scalar Upload')
  for (const s of scalars) lines.push(`scalar ${s}`)
  lines.push('')

  // Pagination types
  lines.push('type PageInfo {')
  lines.push('  hasNextPage: Boolean!')
  lines.push('  hasPreviousPage: Boolean!')
  lines.push('  startCursor: String')
  lines.push('  endCursor: String')
  lines.push('}')
  lines.push('')
  lines.push('type PaginationMeta {')
  lines.push('  total: Int!')
  lines.push('  perPage: Int!')
  lines.push('  currentPage: Int!')
  lines.push('  lastPage: Int!')
  lines.push('  hasMore: Boolean!')
  lines.push('}')
  lines.push('')

  const allQueryLines        = []
  const allMutationLines     = []
  const allSubscriptionLines = []
  const knownTypes = new Set(schemas.map(s => s.name))

  for (const schema of schemas) {
    const sdl = generateGraphqlSDL(schema, { pagination, subscriptions, knownTypes })
    lines.push(sdl.typeDef, '')
    lines.push(sdl.inputCreate, '')
    lines.push(sdl.inputUpdate, '')
    lines.push(sdl.inputWhere, '')
    lines.push(sdl.paginated, '')
    allQueryLines.push(...sdl.queryLines)
    allMutationLines.push(...sdl.mutationLines)
    allSubscriptionLines.push(...sdl.subscriptionLines)
  }

  lines.push('type Query {')
  lines.push(...allQueryLines)
  lines.push('}', '')

  if (allMutationLines.length) {
    lines.push('type Mutation {')
    lines.push(...allMutationLines)
    lines.push('}', '')
  }

  if (allSubscriptionLines.length) {
    lines.push('type Subscription {')
    lines.push(...allSubscriptionLines)
    lines.push('}', '')
  }

  return lines.join('\n')
}

function lcFirst(s) { return s[0].toLowerCase() + s.slice(1) }
