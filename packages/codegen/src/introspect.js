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

function resolveCastType(cast) {
  if (!cast) return DEFAULT_TYPE
  // Normalize 'decimal:2' → 'decimal'
  const base = cast.split(':')[0].toLowerCase()
  return CAST_TYPE_MAP[base] ?? DEFAULT_TYPE
}

// ─── Relation type detection ──────────────────────────────────────────────────
const RELATION_METHODS = ['hasOne', 'hasMany', 'belongsTo', 'belongsToMany', 'hasManyThrough', 'morphTo', 'morphMany', 'morphOne']

function detectRelations(ModelClass) {
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
    const match = src.match(/this\.(hasOne|hasMany|belongsTo|belongsToMany|hasManyThrough|morphTo|morphMany|morphOne)\s*\(/)
    if (!match) continue

    const relType = match[1]
    // Try to extract the related model name from source
    const modelMatch = src.match(/this\.\w+\((\w+)/)
    const relatedName = modelMatch?.[1] ?? 'Unknown'

    const isList = ['hasMany', 'belongsToMany', 'hasManyThrough', 'morphMany'].includes(relType)
    const isPolymorphic = ['morphTo', 'morphMany', 'morphOne'].includes(relType)

    relations.push({
      name,
      type:       relType,
      related:    relatedName,
      isList,
      isPolymorphic,
      nullable:   true,
    })
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
  // ── Accept plain descriptor objects (from CLI scaffold, no live class needed) ──
  if (typeof source !== 'function') {
    return normalizeDescriptor(source)
  }

  const ModelClass = source
  const name   = ModelClass.name
  const table  = ModelClass.table ?? toSnakeCase(name) + 's'
  const pk     = ModelClass.primaryKey ?? 'id'
  const casts  = ModelClass.casts ?? {}
  const hidden = new Set(ModelClass.hidden ?? [])
  const fill   = ModelClass.fillable ?? []

  // ── Build fields list ─────────────────────────────────────────────────────
  const fields = []

  // Primary key
  fields.push({
    name:     pk,
    cast:     'uuid',
    ...ID_TYPE,
    nullable: false,
    hidden:   false,
    fillable: false,
    isPk:     true,
  })

  const TIMESTAMP_COLS   = new Set(['created_at', 'updated_at'])
  const deletedAtColumn  = ModelClass.deletedAtColumn ?? 'deleted_at'

  // Cast fields
  for (const [fieldName, cast] of Object.entries(casts)) {
    if (fieldName === pk) continue
    const typeInfo = resolveCastType(cast)
    const isTs = ModelClass.timestamps !== false && TIMESTAMP_COLS.has(fieldName)
    const isSd = ModelClass.softDeletes && fieldName === deletedAtColumn
    fields.push({
      name:     fieldName,
      cast,
      ...typeInfo,
      nullable:      true,
      hidden:        hidden.has(fieldName),
      fillable:      fill.includes(fieldName),
      isPk:          false,
      isTimestamp:   isTs  || undefined,
      isSoftDelete:  isSd  || undefined,
    })
  }

  // Timestamps (always present unless disabled)
  if (ModelClass.timestamps !== false) {
    for (const col of ['created_at', 'updated_at']) {
      if (!fields.find(f => f.name === col)) {
        fields.push({
          name: col, cast: 'datetime', ...resolveCastType('datetime'),
          nullable: true, hidden: false, fillable: false, isPk: false, isTimestamp: true,
        })
      }
    }
  }

  // Soft delete column
  if (ModelClass.softDeletes) {
    const deletedAt = ModelClass.deletedAtColumn ?? 'deleted_at'
    if (!fields.find(f => f.name === deletedAt)) {
      fields.push({
        name: deletedAt, cast: 'datetime', ...resolveCastType('datetime'),
        nullable: true, hidden: false, fillable: false, isPk: false, isSoftDelete: true,
      })
    }
  }

  // ── GraphQL overrides ─────────────────────────────────────────────────────
  const gqlConfig   = ModelClass.graphql ?? {}
  const gqlHidden   = new Set(
    gqlConfig.fields
      ? Object.entries(gqlConfig.fields).filter(([,v]) => v === false).map(([k]) => k)
      : [...hidden]
  )
  const gqlDisabled = gqlConfig.queries ?? {}

  // ── Assemble schema ───────────────────────────────────────────────────────
  return {
    name,
    table,
    primaryKey:   pk,
    softDeletes:  !!ModelClass.softDeletes,
    timestamps:   ModelClass.timestamps !== false,
    fillable:     fill,
    hidden:       [...hidden],
    fields,
    relations:    detectRelations(ModelClass),
    scopes:       detectScopes(ModelClass),

    // Feature flags
    graphql: {
      hidden:    gqlHidden,
      disabled:  gqlDisabled,
      subscription: gqlConfig.subscription !== false,
      middleware:   gqlConfig.middleware ?? [],
    },

    // Raw class for resolver generation
    ModelClass,
  }
}

/**
 * Introspect multiple Model classes at once.
 * @param {Function[]} models
 * @returns {ModelSchema[]}
 */
export function introspectAll(models) {
  return models.map(m => introspect(m))
}

/**
 * Normalize a plain descriptor (used by CLI generators that don't have live classes).
 */
function normalizeDescriptor(desc) {
  const name   = desc.name ?? 'Unknown'
  const table  = desc.table ?? toSnakeCase(name) + 's'
  const casts  = desc.casts ?? {}
  const hidden = new Set(desc.hidden ?? [])
  const fill   = desc.fillable ?? []
  const pk     = desc.primaryKey ?? 'id'

  const fields = [
    { name: pk, cast: 'uuid', ...ID_TYPE, nullable: false, hidden: false, fillable: false, isPk: true },
    ...Object.entries(casts).map(([fieldName, cast]) => ({
      name: fieldName, cast, ...resolveCastType(cast),
      nullable: true, hidden: hidden.has(fieldName), fillable: fill.includes(fieldName), isPk: false,
    })),
  ]

  if (desc.timestamps !== false) {
    fields.push(
      { name: 'created_at', cast: 'datetime', ...resolveCastType('datetime'), nullable: true, hidden: false, fillable: false, isPk: false, isTimestamp: true },
      { name: 'updated_at', cast: 'datetime', ...resolveCastType('datetime'), nullable: true, hidden: false, fillable: false, isPk: false, isTimestamp: true },
    )
  }
  if (desc.softDeletes) {
    fields.push({ name: 'deleted_at', cast: 'datetime', ...resolveCastType('datetime'), nullable: true, hidden: false, fillable: false, isPk: false, isSoftDelete: true })
  }

  return {
    name, table, primaryKey: pk,
    softDeletes: !!desc.softDeletes,
    timestamps:  desc.timestamps !== false,
    fillable: fill,
    hidden:   [...hidden],
    fields,
    relations: desc.relations ?? [],
    scopes:    desc.scopes ?? [],
    graphql: {
      hidden:       new Set(desc.hidden ?? []),
      disabled:     {},
      subscription: true,
      middleware:   [],
    },
    ModelClass: null,
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function toSnakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

export { resolveCastType, CAST_TYPE_MAP, DEFAULT_TYPE, ID_TYPE }
