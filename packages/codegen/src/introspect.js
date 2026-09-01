/**
 * @eloquentjs/codegen — Model Introspector
 *
 * Reads a live EloquentJS Model class (or a plain descriptor object) and
 * returns a normalized ModelSchema that every template/generator consumes.
 *
 * This is the single source of truth that bridges:
 *   - Runtime Model classes (for GraphQL, TypeScript, OpenAPI generation)
 *   - Plain descriptor objects (for CLI scaffold generation where no DB exists yet)
 */

import { toSnakePlural } from '@eloquentjs/core'

/**
 * @typedef {Object} ModelSchemaField
 * @property {string} name
 * @property {string} [cast]
 * @property {string} jsType
 * @property {string} gqlType
 * @property {string} tsType
 * @property {Record<string, any>} openApiType
 * @property {boolean} nullable
 * @property {boolean} hidden
 * @property {boolean} fillable
 * @property {boolean} isPk
 * @property {boolean} [isTimestamp]
 * @property {boolean} [isSoftDelete]
 *
 * @typedef {Object} ModelSchemaRelation
 * @property {string} name
 * @property {string} type
 * @property {string} related
 * @property {boolean} isList
 * @property {boolean} isPolymorphic
 * @property {boolean} nullable
 *
 * @typedef {Object} ModelSchemaScope
 * @property {string} name
 * @property {string} methodName
 *
 * @typedef {Object} ModelSchema
 * @property {string} name
 * @property {string} table
 * @property {string} primaryKey
 * @property {boolean} softDeletes
 * @property {boolean} timestamps
 * @property {string[]} fillable
 * @property {string[]} hidden
 * @property {ModelSchemaField[]} fields
 * @property {ModelSchemaRelation[]} relations
 * @property {ModelSchemaScope[]} scopes
 * @property {{hidden: Set<string>, disabled: Record<string, any>, subscription: boolean, middleware: any[]}} graphql
 * @property {Function} ModelClass
 */

// ─── Cast → canonical type map ────────────────────────────────────────────────
const CAST_TYPE_MAP = {
  // integers
  integer:    { jsType: 'number',  gqlType: 'Int',     tsType: 'number',  openApiType: { type: 'integer' } },
  int:        { jsType: 'number',  gqlType: 'Int',     tsType: 'number',  openApiType: { type: 'integer' } },
  biginteger: { jsType: 'number',  gqlType: 'Int',     tsType: 'number',  openApiType: { type: 'integer', format: 'int64' } },
  bigint:     { jsType: 'number',  gqlType: 'Int',     tsType: 'number',  openApiType: { type: 'integer', format: 'int64' } },
  // floats / decimals
  float:      { jsType: 'number',  gqlType: 'Float',   tsType: 'number',  openApiType: { type: 'number', format: 'float' } },
  double:     { jsType: 'number',  gqlType: 'Float',   tsType: 'number',  openApiType: { type: 'number', format: 'double' } },
  decimal:    { jsType: 'number',  gqlType: 'Float',   tsType: 'number',  openApiType: { type: 'number' } },
  // strings
  string:     { jsType: 'string',  gqlType: 'String',  tsType: 'string',  openApiType: { type: 'string' } },
  text:       { jsType: 'string',  gqlType: 'String',  tsType: 'string',  openApiType: { type: 'string' } },
  char:       { jsType: 'string',  gqlType: 'String',  tsType: 'string',  openApiType: { type: 'string' } },
  enum:       { jsType: 'string',  gqlType: 'String',  tsType: 'string',  openApiType: { type: 'string' } },
  // ids
  uuid:       { jsType: 'string',  gqlType: 'ID',      tsType: 'string',  openApiType: { type: 'string', format: 'uuid' } },
  // booleans
  boolean:    { jsType: 'boolean', gqlType: 'Boolean', tsType: 'boolean', openApiType: { type: 'boolean' } },
  bool:       { jsType: 'boolean', gqlType: 'Boolean', tsType: 'boolean', openApiType: { type: 'boolean' } },
  // dates
  date:       { jsType: 'Date',    gqlType: 'DateTime', tsType: 'Date',   openApiType: { type: 'string', format: 'date' } },
  datetime:   { jsType: 'Date',    gqlType: 'DateTime', tsType: 'Date',   openApiType: { type: 'string', format: 'date-time' } },
  timestamp:  { jsType: 'Date',    gqlType: 'DateTime', tsType: 'Date',   openApiType: { type: 'string', format: 'date-time' } },
  // json
  json:       { jsType: 'object',  gqlType: 'JSON',    tsType: 'Record<string, unknown>', openApiType: { type: 'object' } },
  jsonb:      { jsType: 'object',  gqlType: 'JSON',    tsType: 'Record<string, unknown>', openApiType: { type: 'object' } },
  array:      { jsType: 'array',   gqlType: 'JSON',    tsType: 'unknown[]',               openApiType: { type: 'array', items: {} } },
  object:     { jsType: 'object',  gqlType: 'JSON',    tsType: 'Record<string, unknown>', openApiType: { type: 'object' } },
}

const DEFAULT_TYPE = { jsType: 'string', gqlType: 'String', tsType: 'string', openApiType: { type: 'string' } }
const ID_TYPE      = { jsType: 'string', gqlType: 'ID',     tsType: 'string', openApiType: { type: 'string' } }

/**
 * @param {string|Function|Object|undefined} cast
 * CastRegistry accepts a class or an inline {get,set} object as well as a
 * string; `cast.split(':')` threw on those.
 */
function resolveCastType(cast) {
  if (!cast) return DEFAULT_TYPE
  if (typeof cast !== 'string') {
    // A class-based cast can declare its shape: `static codegenType = 'json'`.
    const declared = /** @type {any} */ (cast)?.codegenType
    return (declared && CAST_TYPE_MAP[String(declared).toLowerCase()]) ?? DEFAULT_TYPE
  }
  // Normalize 'decimal:2' → 'decimal'
  const base = cast.split(':')[0].toLowerCase()
  return CAST_TYPE_MAP[base] ?? DEFAULT_TYPE
}

/** A cast value that can be written into a generated stub, or undefined. */
function castLabel(cast) {
  return typeof cast === 'string' ? cast : undefined
}

// ─── Relation type detection ──────────────────────────────────────────────────
const RELATION_METHODS = [
  'hasOne', 'hasMany', 'belongsTo', 'belongsToMany', 'hasManyThrough',
  'hasOneThrough', 'morphTo', 'morphMany', 'morphOne', 'morphToMany', 'morphedByMany',
]

/**
 * Relations, preferring an explicit declaration.
 *
 *   static relations = {
 *     posts:   { type: 'hasMany',   related: 'Post' },
 *     profile: { type: 'hasOne',    related: 'Profile' },
 *   }
 *
 * The fallback regexes `Function.prototype.toString()`, which returns
 * `function(){[native code]}`-style output under some bundlers and is mangled
 * by minifiers — hence the declarative option.
 */
function detectRelations(ModelClass) {
  const declared = ModelClass?.relations
  if (declared && typeof declared === 'object') {
    return Object.entries(declared).map(([name, def]) => normalizeRelation(name, def))
  }
  return detectRelationsFromSource(ModelClass)
}

function normalizeRelation(name, def) {
  const type = def.type ?? 'hasMany'
  const related = typeof def.related === 'function' ? def.related.name : (def.related ?? 'Unknown')
  return {
    name,
    type,
    related,
    isList: def.isList ?? LIST_RELATIONS.includes(type),
    isPolymorphic: def.isPolymorphic ?? POLYMORPHIC_RELATIONS.includes(type),
    nullable: def.nullable ?? true,
  }
}

const LIST_RELATIONS = ['hasMany', 'belongsToMany', 'hasManyThrough', 'morphMany', 'morphToMany', 'morphedByMany']
const POLYMORPHIC_RELATIONS = ['morphTo', 'morphMany', 'morphOne', 'morphToMany', 'morphedByMany']

function detectRelationsFromSource(ModelClass) {
  const relations = []
  if (!ModelClass?.prototype) return relations

  const proto = ModelClass.prototype
  const names = Object.getOwnPropertyNames(proto).filter(n =>
    n !== 'constructor' && !n.startsWith('_') && !n.startsWith('get') && !n.startsWith('set') && !n.startsWith('scope')
  )

  for (const name of names) {
    if (typeof proto[name] !== 'function') continue
    // Introspect function body to detect relation type
    const src = proto[name].toString()
    const match = src.match(new RegExp(`this\\.(${RELATION_METHODS.join('|')})\\s*\\(`))
    if (!match) continue

    // Try to extract the related model name from source
    const modelMatch = src.match(/this\.\w+\((\w+)/)
    relations.push(normalizeRelation(name, { type: match[1], related: modelMatch?.[1] ?? 'Unknown' }))
  }

  return relations
}

// ─── Scope detection ──────────────────────────────────────────────────────────
function detectScopes(ModelClass) {
  if (!ModelClass) return []
  return Object.getOwnPropertyNames(ModelClass)
    .filter(n => n.startsWith('scope') && n.length > 5)
    .map(n => ({
      name:      n[5].toLowerCase() + n.slice(6),   // scopeActive → active
      methodName: n,
    }))
}

// ─── Main introspect function ─────────────────────────────────────────────────

/**
 * Introspect a Model class (or a plain descriptor) and return a normalized ModelSchema.
 *
 * @param {Function|Object} source — a Model subclass or a plain descriptor
 * @returns {ModelSchema}
 */
export function introspect(source) {
  const isClass = typeof source === 'function'
  const ModelClass = isClass ? source : null
  const desc = isClass ? source : (source ?? {})

  const name = desc.name ?? 'Unknown'
  const table = desc.table ?? toSnakePlural(name)
  const pk = desc.primaryKey ?? 'id'
  const keyType = desc.keyType ?? (isClass ? 'integer' : 'integer')
  const casts = desc.casts ?? {}
  const hidden = new Set(desc.hidden ?? [])
  const fill = desc.fillable ?? []
  const timestamps = desc.timestamps !== false
  const softDeletes = !!desc.softDeletes
  const deletedAtColumn = desc.deletedAtColumn ?? 'deleted_at'
  const createdAtColumn = desc.createdAtColumn ?? 'created_at'
  const updatedAtColumn = desc.updatedAtColumn ?? 'updated_at'

  const fields = buildFields({
    pk, keyType, casts, hidden, fill, timestamps, softDeletes,
    deletedAtColumn, createdAtColumn, updatedAtColumn,
    // An explicit column map is the way to declare types for columns that have
    // no cast: `static columns = { name: 'string', email: 'string' }`
    columns: desc.columns ?? {},
    // `nonNullable` names columns the generator should not mark optional.
    nonNullable: new Set(desc.nonNullable ?? []),
  })

  // ── GraphQL overrides ─────────────────────────────────────────────────────
  const gqlConfig = desc.graphql ?? {}
  // The UNION of `hidden` and explicit `false` entries. Setting graphql.fields
  // used to *replace* the hidden set, so `static hidden = ['password']` silently
  // stopped applying and the column appeared in the GraphQL type.
  const gqlHidden = new Set([
    ...hidden,
    ...(gqlConfig.fields
      ? Object.entries(gqlConfig.fields).filter(([, v]) => v === false).map(([k]) => k)
      : []),
  ])
  const gqlDisabled = gqlConfig.queries ?? {}

  // ── Assemble schema ───────────────────────────────────────────────────────
  return {
    name,
    table,
    primaryKey: pk,
    softDeletes,
    timestamps,
    fillable: fill,
    hidden: [...hidden],
    fields,
    relations: isClass ? detectRelations(ModelClass) : (desc.relations ?? []),
    scopes: isClass ? detectScopes(ModelClass) : (desc.scopes ?? []),

    // Feature flags
    graphql: {
      hidden: gqlHidden,
      disabled: gqlDisabled,
      subscription: gqlConfig.subscription !== false,
      middleware: gqlConfig.middleware ?? [],
    },

    // Raw class for resolver generation
    ModelClass,
  }
}

/**
 * The field list, from every source that tells us a column exists:
 * `casts`, `columns`, `fillable`, the primary key, timestamps, soft deletes.
 *
 * Deriving it from `casts` alone (the previous behaviour) meant a model with
 * `fillable: ['name','email']` and no casts generated a GraphQL type, a
 * TypeScript interface and an OpenAPI schema containing only id and timestamps.
 */
function buildFields({
  pk, keyType, casts, hidden, fill, timestamps, softDeletes,
  deletedAtColumn, createdAtColumn, updatedAtColumn, columns, nonNullable,
}) {
  const fields = []
  const seen = new Set()
  const timestampCols = new Set(timestamps ? [createdAtColumn, updatedAtColumn] : [])

  const add = (fieldName, cast, extra = {}) => {
    if (seen.has(fieldName)) return
    seen.add(fieldName)
    fields.push({
      name: fieldName,
      cast: castLabel(cast),
      ...resolveCastType(cast),
      nullable: !nonNullable.has(fieldName),
      hidden: hidden.has(fieldName),
      fillable: fill.includes(fieldName),
      isPk: false,
      ...extra,
    })
  }

  // Primary key — an integer key is an integer, not a uuid string.
  seen.add(pk)
  fields.push({
    name: pk,
    cast: keyType === 'uuid' ? 'uuid' : 'integer',
    ...(keyType === 'uuid' ? ID_TYPE : { ...CAST_TYPE_MAP.integer, gqlType: 'ID' }),
    nullable: false,
    hidden: hidden.has(pk),
    fillable: false,
    isPk: true,
  })

  // Cast fields
  for (const [fieldName, cast] of Object.entries(casts)) {
    add(fieldName, cast, {
      isTimestamp: timestampCols.has(fieldName) || undefined,
      isSoftDelete: (softDeletes && fieldName === deletedAtColumn) || undefined,
    })
  }

  // Explicitly declared columns
  for (const [fieldName, cast] of Object.entries(columns)) add(fieldName, cast)

  // Fillable columns with no declared cast default to string — except a
  // `*_id` foreign key, which holds the same kind of value as the primary
  // key it points to (an integer, or a uuid if the app casts it explicitly)
  // and should generate as ID, not String, for the same reason the PK does.
  for (const fieldName of fill) {
    const isForeignKey = fieldName !== pk && fieldName.endsWith('_id')
    add(fieldName, undefined, isForeignKey ? { cast: 'integer', ...CAST_TYPE_MAP.integer, gqlType: 'ID' } : {})
  }

  // Timestamps (always present unless disabled)
  if (timestamps) {
    for (const col of [createdAtColumn, updatedAtColumn]) {
      add(col, 'datetime', { isTimestamp: true })
    }
  }

  // Soft delete column
  if (softDeletes) add(deletedAtColumn, 'datetime', { isSoftDelete: true })

  return fields
}

/**
 * Introspect multiple Model classes at once.
 * @param {Function[]} models
 * @returns {ModelSchema[]}
 */
export function introspectAll(models) {
  return models.map(m => introspect(m))
}

// normalizeDescriptor() used to live here: ~40 duplicated lines of the same
// field logic that had already drifted (it hard-coded 'deleted_at' and
// 'created_at'/'updated_at'). Descriptors and live classes now go through
// introspect()/buildFields() together.

export { resolveCastType, CAST_TYPE_MAP, DEFAULT_TYPE, ID_TYPE }
