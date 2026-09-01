/**
 * @eloquentjs/codegen — Unit Tests
 *
 * Tests the introspector, all templates (graphql, typescript, openapi, stubs),
 * and the render orchestrator using mock Model classes and plain descriptors.
 */

import { jest } from '@jest/globals'

// ─── Mock fs so render tests don't hit disk ───────────────────────────────────
const mockFs = {
  existsSync:   jest.fn(),
  readdirSync:  jest.fn(),
  writeFileSync: jest.fn(),
  mkdirSync:    jest.fn(),
}
jest.unstable_mockModule('fs', () => mockFs)

// ─── Import codegen modules after mocks ───────────────────────────────────────
const { introspect, introspectAll, resolveCastType, CAST_TYPE_MAP } =
  await import('../../packages/codegen/src/introspect.js')

const { generateGraphqlSDL, generateGraphqlSchema } =
  await import('../../packages/codegen/src/templates/graphql.js')

const { generateTypeScriptTypes, generateTypeScriptFile } =
  await import('../../packages/codegen/src/templates/typescript.js')

const { generateOpenApiSpec } =
  await import('../../packages/codegen/src/templates/openapi.js')

const { generateModelStub, generateMigrationStub, generateFactoryStub, generateSeederStub } =
  await import('../../packages/codegen/src/templates/stubs.js')

// ─── Test Model fixtures ───────────────────────────────────────────────────────

class User {
  static table      = 'users'
  static primaryKey = 'id'
  static fillable   = ['name', 'email', 'password']
  static hidden     = ['password']
  static timestamps = true
  static softDeletes = false
  static casts = {
    name:       'string',
    email:      'string',
    password:   'string',
    is_admin:   'boolean',
    score:      'integer',
    balance:    'decimal:2',
    settings:   'json',
    born_at:    'date',
    created_at: 'datetime',
    updated_at: 'datetime',
  }
  posts()   { return this.hasMany('Post') }
  profile() { return this.hasOne('Profile') }
  static scopeActive(qb)  { return qb.where('active', true) }
  static scopeAdmins(qb)  { return qb.where('is_admin', true) }
}

class Post {
  static table       = 'posts'
  static primaryKey  = 'id'
  static fillable    = ['title', 'body', 'user_id']
  static hidden      = []
  static timestamps  = true
  static softDeletes = true
  static casts = {
    title:  'string',
    body:   'text',
    status: 'string',
  }
  static graphql = {
    fields:       { internal_hash: false },
    subscription: false,
  }
  user()     { return this.belongsTo('User') }
  comments() { return this.hasMany('Comment') }
}

// Plain descriptor (no live class, used by CLI scaffold)
const plainDescriptor = {
  name:        'Category',
  table:       'categories',
  primaryKey:  'id',
  fillable:    ['name', 'slug'],
  hidden:      [],
  timestamps:  true,
  softDeletes: false,
  casts: {
    name: 'string',
    slug: 'string',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// resolveCastType
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCastType', () => {
  test.each([
    ['integer',   'Int',     'number',  'integer'],
    ['int',       'Int',     'number',  'integer'],
    ['biginteger','Int',     'number',  'integer'],
    ['float',     'Float',   'number',  'number'],
    ['double',    'Float',   'number',  'number'],
    ['decimal',   'Float',   'number',  'number'],
    ['decimal:2', 'Float',   'number',  'number'],
    ['string',    'String',  'string',  'string'],
    ['text',      'String',  'string',  'string'],
    ['boolean',   'Boolean', 'boolean', 'boolean'],
    ['bool',      'Boolean', 'boolean', 'boolean'],
    ['date',      'DateTime','Date',    'string'],
    ['datetime',  'DateTime','Date',    'string'],
    ['timestamp', 'DateTime','Date',    'string'],
    ['json',      'JSON',    'Record<string, unknown>', 'object'],
    ['jsonb',     'JSON',    'Record<string, unknown>', 'object'],
    ['array',     'JSON',    'unknown[]',               'array'],
    ['uuid',      'ID',      'string',  'string'],
  ])('cast "%s" → gqlType=%s tsType=%s openApiType.type=%s', (cast, gqlType, tsType, openApiTypeType) => {
    const t = resolveCastType(cast)
    expect(t.gqlType).toBe(gqlType)
    expect(t.tsType).toBe(tsType)
    expect(t.openApiType.type).toBe(openApiTypeType)
  })

  test('unknown cast returns string defaults', () => {
    const t = resolveCastType('custom_thing')
    expect(t.gqlType).toBe('String')
    expect(t.tsType).toBe('string')
  })

  test('null/undefined cast returns string defaults', () => {
    expect(resolveCastType(null).gqlType).toBe('String')
    expect(resolveCastType(undefined).gqlType).toBe('String')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// introspect — from live Model class
// ─────────────────────────────────────────────────────────────────────────────
describe('introspect — live Model class', () => {
  let schema

  beforeAll(() => {
    schema = introspect(User)
  })

  test('extracts correct name and table', () => {
    expect(schema.name).toBe('User')
    expect(schema.table).toBe('users')
  })

  test('extracts primaryKey', () => {
    expect(schema.primaryKey).toBe('id')
  })

  test('includes id field with ID type, typed from keyType', () => {
    // The PK used to be hard-coded as a uuid string even for integer keys.
    const idField = schema.fields.find(f => f.isPk)
    expect(idField).toBeDefined()
    expect(idField.name).toBe('id')
    expect(idField.gqlType).toBe('ID')
    expect(idField.tsType).toBe('number')
    expect(idField.fillable).toBe(false)
  })

  test('a uuid keyType produces a string id', () => {
    class UuidModel {
      static table = 'things'
      static keyType = 'uuid'
      static timestamps = false
    }
    const pkField = introspect(UuidModel).fields.find(f => f.isPk)
    expect(pkField.tsType).toBe('string')
  })

  test('fillable columns appear even with no casts declared', () => {
    // Deriving fields from `casts` alone produced a type with only
    // id/created_at/updated_at, hiding every real column.
    class Bare {
      static table = 'bares'
      static fillable = ['name', 'email']
      static timestamps = false
    }
    const names = introspect(Bare).fields.map(f => f.name)
    expect(names).toEqual(expect.arrayContaining(['id', 'name', 'email']))
  })

  test('an uncast `*_id` fillable column defaults to ID, like the primary key', () => {
    // Every other fillable column with no cast defaults to String, but a
    // foreign key holds the same kind of value as the primary key it points
    // to — typing it String produced a GraphQL schema that rejected the
    // numeric id it actually receives.
    class Post {
      static table = 'posts'
      static fillable = ['title', 'user_id']
      static timestamps = false
    }
    const fields = introspect(Post).fields
    const userId = fields.find(f => f.name === 'user_id')
    expect(userId.gqlType).toBe('ID')
    expect(userId.tsType).toBe('number')
    expect(fields.find(f => f.name === 'title').gqlType).toBe('String')
  })

  test('an explicit cast on a `*_id` column is not overridden', () => {
    class Post {
      static table = 'posts'
      static fillable = ['user_id']
      static casts = { user_id: 'string' }
      static timestamps = false
    }
    const userId = introspect(Post).fields.find(f => f.name === 'user_id')
    expect(userId.gqlType).toBe('String')
  })

  test('graphql.fields does not un-hide `hidden` columns', () => {
    class Secretive {
      static table = 'secretives'
      static fillable = ['name']
      static hidden = ['password']
      static timestamps = false
      static graphql = { fields: { internal_note: false } }
    }
    const gqlHidden = introspect(Secretive).graphql.hidden
    expect(gqlHidden.has('password')).toBe(true)
    expect(gqlHidden.has('internal_note')).toBe(true)
  })

  test('a class-based cast does not throw', () => {
    class JsonBlob { get(v) { return v } set(v) { return v } }
    class WithClassCast {
      static table = 'blobs'
      static casts = { meta: JsonBlob }
      static timestamps = false
    }
    expect(() => introspect(WithClassCast)).not.toThrow()
    expect(introspect(WithClassCast).fields.find(f => f.name === 'meta')).toBeDefined()
  })

  test('static relations is preferred over source scraping', () => {
    class Declared {
      static table = 'declareds'
      static timestamps = false
      static relations = { posts: { type: 'hasMany', related: 'Post' } }
    }
    const rels = introspect(Declared).relations
    expect(rels).toHaveLength(1)
    expect(rels[0]).toMatchObject({ name: 'posts', type: 'hasMany', related: 'Post', isList: true })
  })

  test('maps boolean cast correctly', () => {
    const field = schema.fields.find(f => f.name === 'is_admin')
    expect(field.gqlType).toBe('Boolean')
    expect(field.tsType).toBe('boolean')
    expect(field.openApiType.type).toBe('boolean')
  })

  test('maps integer cast correctly', () => {
    const field = schema.fields.find(f => f.name === 'score')
    expect(field.gqlType).toBe('Int')
    expect(field.tsType).toBe('number')
  })

  test('maps decimal cast correctly', () => {
    const field = schema.fields.find(f => f.name === 'balance')
    expect(field.gqlType).toBe('Float')
    expect(field.tsType).toBe('number')
  })

  test('maps json cast correctly', () => {
    const field = schema.fields.find(f => f.name === 'settings')
    expect(field.gqlType).toBe('JSON')
    expect(field.tsType).toContain('Record')
  })

  test('marks hidden fields', () => {
    const field = schema.fields.find(f => f.name === 'password')
    expect(field.hidden).toBe(true)
  })

  test('marks fillable fields', () => {
    const nameField = schema.fields.find(f => f.name === 'name')
    expect(nameField.fillable).toBe(true)
    const scoreField = schema.fields.find(f => f.name === 'score')
    expect(scoreField.fillable).toBe(false)
  })

  test('adds timestamp fields', () => {
    expect(schema.timestamps).toBe(true)
    const tsFields = schema.fields.filter(f => f.isTimestamp)
    expect(tsFields).toHaveLength(2)
    expect(tsFields.map(f => f.name)).toEqual(expect.arrayContaining(['created_at', 'updated_at']))
  })

  test('no soft-delete field when softDeletes=false', () => {
    const sdField = schema.fields.find(f => f.isSoftDelete)
    expect(sdField).toBeUndefined()
    expect(schema.softDeletes).toBe(false)
  })

  test('detects scopes', () => {
    expect(schema.scopes.length).toBeGreaterThanOrEqual(2)
    expect(schema.scopes.map(s => s.name)).toContain('active')
    expect(schema.scopes.map(s => s.name)).toContain('admins')
  })

  test('detects relations', () => {
    expect(schema.relations.length).toBeGreaterThanOrEqual(2)
    const postsRel = schema.relations.find(r => r.name === 'posts')
    expect(postsRel).toBeDefined()
    expect(postsRel.type).toBe('hasMany')
    expect(postsRel.isList).toBe(true)
    const profileRel = schema.relations.find(r => r.name === 'profile')
    expect(profileRel).toBeDefined()
    expect(profileRel.type).toBe('hasOne')
    expect(profileRel.isList).toBe(false)
  })

  test('softDeletes=true adds deleted_at field', () => {
    const postSchema = introspect(Post)
    expect(postSchema.softDeletes).toBe(true)
    const sdField = postSchema.fields.find(f => f.isSoftDelete)
    expect(sdField).toBeDefined()
    expect(sdField.name).toBe('deleted_at')
  })

  test('graphql hidden fields are tracked', () => {
    const postSchema = introspect(Post)
    expect(postSchema.graphql.hidden.has('internal_hash')).toBe(true)
  })

  test('graphql subscription=false is respected', () => {
    const postSchema = introspect(Post)
    expect(postSchema.graphql.subscription).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// introspect — from plain descriptor
// ─────────────────────────────────────────────────────────────────────────────
describe('introspect — plain descriptor', () => {
  let schema

  beforeAll(() => {
    schema = introspect(plainDescriptor)
  })

  test('extracts name and table', () => {
    expect(schema.name).toBe('Category')
    expect(schema.table).toBe('categories')
  })

  test('includes id field', () => {
    expect(schema.fields.find(f => f.isPk)).toBeDefined()
  })

  test('includes cast fields', () => {
    expect(schema.fields.find(f => f.name === 'name')).toBeDefined()
    expect(schema.fields.find(f => f.name === 'slug')).toBeDefined()
  })

  test('adds timestamp fields', () => {
    const ts = schema.fields.filter(f => f.isTimestamp)
    expect(ts).toHaveLength(2)
  })

  test('ModelClass is null for descriptors', () => {
    expect(schema.ModelClass).toBeNull()
  })

  test('no relations or scopes for bare descriptor', () => {
    expect(schema.relations).toEqual([])
    expect(schema.scopes).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// introspectAll
// ─────────────────────────────────────────────────────────────────────────────
describe('introspectAll', () => {
  test('returns array of schemas', () => {
    const schemas = introspectAll([User, Post])
    expect(schemas).toHaveLength(2)
    expect(schemas[0].name).toBe('User')
    expect(schemas[1].name).toBe('Post')
  })

  test('empty array returns empty array', () => {
    expect(introspectAll([])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateGraphqlSDL
// ─────────────────────────────────────────────────────────────────────────────
describe('generateGraphqlSDL', () => {
  let userSchema, postSchema

  beforeAll(() => {
    userSchema = introspect(User)
    postSchema = introspect(Post)
  })

  test('generates type definition with correct name', () => {
    const { typeDef } = generateGraphqlSDL(userSchema)
    expect(typeDef).toContain('type User {')
    expect(typeDef).toContain('id: ID')
  })

  test('visible fields appear in type', () => {
    const { typeDef } = generateGraphqlSDL(userSchema)
    expect(typeDef).toContain('name: String')
    expect(typeDef).toContain('is_admin: Boolean')
    expect(typeDef).toContain('score: Int')
  })

  test('hidden fields do not appear in type', () => {
    const { typeDef } = generateGraphqlSDL(userSchema)
    expect(typeDef).not.toContain('password')
  })

  test('generates Create and Update input types', () => {
    const { inputCreate, inputUpdate } = generateGraphqlSDL(userSchema)
    expect(inputCreate).toContain('input CreateUserInput {')
    expect(inputUpdate).toContain('input UpdateUserInput {')
  })

  test('primary key excluded from input types', () => {
    const { inputCreate } = generateGraphqlSDL(userSchema)
    expect(inputCreate).not.toContain('id:')
  })

  test('timestamp fields excluded from input types', () => {
    const { inputCreate } = generateGraphqlSDL(userSchema)
    expect(inputCreate).not.toContain('created_at')
    expect(inputCreate).not.toContain('updated_at')
  })

  test('generates WhereInput with AND/OR', () => {
    const { inputWhere } = generateGraphqlSDL(userSchema)
    expect(inputWhere).toContain(`input UserWhereInput {`)
    expect(inputWhere).toContain('AND: [UserWhereInput]')
    expect(inputWhere).toContain('OR: [UserWhereInput]')
  })

  test('generates offset pagination type by default', () => {
    const { paginated } = generateGraphqlSDL(userSchema)
    expect(paginated).toContain('type UserPage {')
    expect(paginated).toContain('data: [User!]!')
    expect(paginated).toContain('meta: PaginationMeta!')
  })

  test('generates relay pagination type when specified', () => {
    const { paginated } = generateGraphqlSDL(userSchema, { pagination: 'relay' })
    expect(paginated).toContain('type UserEdge {')
    expect(paginated).toContain('type UserConnection {')
    expect(paginated).toContain('edges: [UserEdge!]!')
  })

  test('generates query lines', () => {
    const { queryLines } = generateGraphqlSDL(userSchema)
    expect(queryLines.some(l => l.includes('user(id: ID!)'))).toBe(true)
    expect(queryLines.some(l => l.includes('users('))).toBe(true)
    expect(queryLines.some(l => l.includes('usersCount('))).toBe(true)
  })

  test('generates mutation lines', () => {
    const { mutationLines } = generateGraphqlSDL(userSchema)
    expect(mutationLines.some(l => l.includes('createUser('))).toBe(true)
    expect(mutationLines.some(l => l.includes('updateUser('))).toBe(true)
    expect(mutationLines.some(l => l.includes('deleteUser('))).toBe(true)
    expect(mutationLines.some(l => l.includes('upsertUser('))).toBe(true)
  })

  test('generates soft-delete mutations when softDeletes=true', () => {
    const { mutationLines } = generateGraphqlSDL(postSchema)
    expect(mutationLines.some(l => l.includes('restorePost('))).toBe(true)
    expect(mutationLines.some(l => l.includes('forceDeletePost('))).toBe(true)
  })

  test('no soft-delete mutations when softDeletes=false', () => {
    const { mutationLines } = generateGraphqlSDL(userSchema)
    expect(mutationLines.some(l => l.includes('restoreUser'))).toBe(false)
    expect(mutationLines.some(l => l.includes('forceDeleteUser'))).toBe(false)
  })

  test('generates subscription lines by default', () => {
    const { subscriptionLines } = generateGraphqlSDL(userSchema, { subscriptions: true })
    expect(subscriptionLines.some(l => l.includes('userCreated'))).toBe(true)
    expect(subscriptionLines.some(l => l.includes('userUpdated'))).toBe(true)
    expect(subscriptionLines.some(l => l.includes('userDeleted'))).toBe(true)
  })

  test('no subscription lines when graphql.subscription=false', () => {
    const { subscriptionLines } = generateGraphqlSDL(postSchema, { subscriptions: true })
    expect(subscriptionLines).toHaveLength(0)
  })

  test('no subscription lines when subscriptions option is false', () => {
    const { subscriptionLines } = generateGraphqlSDL(userSchema, { subscriptions: false })
    expect(subscriptionLines).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateGraphqlSchema — full SDL file
// ─────────────────────────────────────────────────────────────────────────────
describe('generateGraphqlSchema', () => {
  let schemas, sdl

  beforeAll(() => {
    schemas = introspectAll([User, Post])
    sdl     = generateGraphqlSchema(schemas)
  })

  test('includes generation header comment', () => {
    expect(sdl).toContain('# Auto-generated by @eloquentjs/codegen')
  })

  test('includes scalar declarations', () => {
    expect(sdl).toContain('scalar JSON')
    expect(sdl).toContain('scalar DateTime')
  })

  test('includes both model types', () => {
    expect(sdl).toContain('type User {')
    expect(sdl).toContain('type Post {')
  })

  test('includes Query type with all models', () => {
    expect(sdl).toContain('type Query {')
    expect(sdl).toContain('user(id: ID!)')
    expect(sdl).toContain('post(id: ID!)')
  })

  test('includes Mutation type', () => {
    expect(sdl).toContain('type Mutation {')
    expect(sdl).toContain('createUser(')
    expect(sdl).toContain('createPost(')
  })

  test('includes Subscription type', () => {
    expect(sdl).toContain('type Subscription {')
    expect(sdl).toContain('userCreated')
    // Post has subscription: false, so postCreated should not appear
    expect(sdl).not.toContain('postCreated')
  })

  test('no header when header=false', () => {
    const noHeader = generateGraphqlSchema(schemas, { header: false })
    expect(noHeader).not.toContain('# Auto-generated')
  })

  // User declares `profile() { return this.hasOne('Profile') }`, but Profile
  // isn't one of the models passed to generateGraphqlSchema([User, Post]) —
  // exactly the "generate SDL for a subset of an app's models" case the
  // README's own `buildSchema([User, Post, Comment])` example demonstrates.
  // A relation field unconditionally typed `profile: Profile` with no
  // `type Profile` anywhere in the document is invalid SDL: buildSchema()
  // (graphql-js) rejects the whole document with "Unknown type Profile".
  test('a relation to a model outside the generated set is dropped, not left dangling', async () => {
    const { buildSchema: buildGraphQLSchema } = await import('graphql')
    expect(sdl).not.toMatch(/profile:\s*Profile\b/)
    expect(() => buildGraphQLSchema(sdl)).not.toThrow()
  })

  test('custom scalars are included', () => {
    const withScalars = generateGraphqlSchema(schemas, { scalars: ['BigInt', 'Upload'] })
    expect(withScalars).toContain('scalar BigInt')
    expect(withScalars).toContain('scalar Upload')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateTypeScriptTypes
// ─────────────────────────────────────────────────────────────────────────────
describe('generateTypeScriptTypes', () => {
  let userSchema

  beforeAll(() => { userSchema = introspect(User) })

  test('generates interface with correct name', () => {
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toContain('export interface User {')
  })

  test('id field type follows keyType', () => {
    // Was hard-coded to string even for an integer primary key.
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toContain('id')
    expect(ts).toMatch(/id\??:\s*number/)

    const uuidSchema = introspect(class Thing { static keyType = 'uuid'; static timestamps = false })
    expect(generateTypeScriptTypes(uuidSchema)).toMatch(/id\??:\s*string/)
  })

  test('boolean cast → boolean type', () => {
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toContain('is_admin')
    expect(ts).toMatch(/is_admin\??:\s*boolean/)
  })

  test('integer cast → number type', () => {
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toMatch(/score\??:\s*number/)
  })

  test('json cast → Record type', () => {
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toMatch(/settings\??:\s*Record/)
  })

  test('datetime cast → Date type', () => {
    const ts = generateTypeScriptTypes(userSchema)
    expect(ts).toMatch(/created_at\??:\s*Date/)
  })

  test('generates CreateInput interface', () => {
    const ts = generateTypeScriptTypes(userSchema, { includeCreateInput: true })
    expect(ts).toContain('export interface CreateUserInput {')
  })

  test('generates UpdateInput interface', () => {
    const ts = generateTypeScriptTypes(userSchema, { includeUpdateInput: true })
    expect(ts).toContain('export interface UpdateUserInput {')
  })

  test('id not in CreateInput', () => {
    const ts = generateTypeScriptTypes(userSchema, { includeCreateInput: true })
    const createSection = ts.slice(ts.indexOf('CreateUserInput'), ts.indexOf('UpdateUserInput') || ts.length)
    expect(createSection).not.toMatch(/^\s*id[?]?:/)
  })

  test('hidden fields excluded from input types', () => {
    const ts = generateTypeScriptTypes(userSchema, { includeCreateInput: true })
    const createSection = ts.slice(ts.indexOf('CreateUserInput'))
    expect(createSection).not.toContain('password')
  })

  test('WhereInput generated when requested', () => {
    const ts = generateTypeScriptTypes(userSchema, { includeWhereInput: true })
    expect(ts).toContain('export interface UserWhereInput {')
    expect(ts).toContain('AND?: UserWhereInput[]')
    expect(ts).toContain('OR?: UserWhereInput[]')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateTypeScriptFile
// ─────────────────────────────────────────────────────────────────────────────
describe('generateTypeScriptFile', () => {
  test('includes header comment', () => {
    const ts = generateTypeScriptFile(introspectAll([User]))
    expect(ts).toContain('// Auto-generated by @eloquentjs/codegen')
  })

  test('includes PaginationMeta interface', () => {
    const ts = generateTypeScriptFile(introspectAll([User]))
    expect(ts).toContain('export interface PaginationMeta {')
    expect(ts).toContain('total: number')
  })

  test('includes PaginatedResult generic', () => {
    const ts = generateTypeScriptFile(introspectAll([User]))
    expect(ts).toContain('export interface PaginatedResult<T>')
    expect(ts).toContain('data: T[]')
  })

  test('includes all model interfaces', () => {
    const ts = generateTypeScriptFile(introspectAll([User, Post]))
    expect(ts).toContain('export interface User {')
    expect(ts).toContain('export interface Post {')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateOpenApiSpec
// ─────────────────────────────────────────────────────────────────────────────
describe('generateOpenApiSpec', () => {
  let userSchema, postSchema, spec

  beforeAll(() => {
    userSchema = introspect(User)
    postSchema = introspect(Post)
    spec = generateOpenApiSpec([userSchema, postSchema])
  })

  test('returns openapi 3.0.3 spec', () => {
    expect(spec.openapi).toBe('3.0.3')
  })

  test('has info object', () => {
    expect(spec.info).toBeDefined()
    expect(spec.info.title).toBeDefined()
    expect(spec.info.version).toBeDefined()
  })

  test('has tags for each model', () => {
    expect(spec.tags.map(t => t.name)).toContain('User')
    expect(spec.tags.map(t => t.name)).toContain('Post')
  })

  test('has component schemas for each model', () => {
    expect(spec.components.schemas['User']).toBeDefined()
    expect(spec.components.schemas['Post']).toBeDefined()
  })

  test('has CreateInput and UpdateInput schemas', () => {
    expect(spec.components.schemas['CreateUserInput']).toBeDefined()
    expect(spec.components.schemas['UpdateUserInput']).toBeDefined()
  })

  test('has PaginationMeta schema', () => {
    expect(spec.components.schemas['PaginationMeta']).toBeDefined()
  })

  test('has paths for list and create', () => {
    expect(spec.paths['/api/users']).toBeDefined()
    expect(spec.paths['/api/users'].get).toBeDefined()
    expect(spec.paths['/api/users'].post).toBeDefined()
  })

  test('has paths for get/update/delete by id', () => {
    expect(spec.paths['/api/users/{id}']).toBeDefined()
    expect(spec.paths['/api/users/{id}'].get).toBeDefined()
    expect(spec.paths['/api/users/{id}'].put).toBeDefined()
    expect(spec.paths['/api/users/{id}'].patch).toBeDefined()
    expect(spec.paths['/api/users/{id}'].delete).toBeDefined()
  })

  test('has soft-delete paths when softDeletes=true', () => {
    expect(spec.paths['/api/posts/trashed']).toBeDefined()
    expect(spec.paths['/api/posts/{id}/restore']).toBeDefined()
  })

  test('no soft-delete paths when softDeletes=false', () => {
    expect(spec.paths['/api/users/trashed']).toBeUndefined()
    expect(spec.paths['/api/users/{id}/restore']).toBeUndefined()
  })

  test('has response error components', () => {
    expect(spec.components.responses['NotFound']).toBeDefined()
    expect(spec.components.responses['ValidationError']).toBeDefined()
  })

  test('operationIds are unique and correct', () => {
    expect(spec.paths['/api/users'].get.operationId).toBe('listUser')
    expect(spec.paths['/api/users'].post.operationId).toBe('createUser')
    expect(spec.paths['/api/users/{id}'].get.operationId).toBe('getUser')
    expect(spec.paths['/api/users/{id}'].delete.operationId).toBe('deleteUser')
  })

  test('pagination query params on list endpoint', () => {
    const params = spec.paths['/api/users'].get.parameters
    expect(params.some(p => p.name === 'page')).toBe(true)
    expect(params.some(p => p.name === 'per_page')).toBe(true)
    expect(params.some(p => p.name === 'search')).toBe(true)
    expect(params.some(p => p.name === 'sort')).toBe(true)
  })

  test('custom title is reflected in spec', () => {
    const custom = generateOpenApiSpec([userSchema], { title: 'My API', version: '2.0.0' })
    expect(custom.info.title).toBe('My API')
    expect(custom.info.version).toBe('2.0.0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateModelStub
// ─────────────────────────────────────────────────────────────────────────────
describe('generateModelStub', () => {
  let userSchema

  beforeAll(() => { userSchema = introspect(User) })

  test('generates class with correct name', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain('class User extends Model')
  })

  test('includes correct table name', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain("static table    = 'users'")
  })

  test('includes fillable array', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain('static fillable')
    expect(stub).toContain("'name'")
    expect(stub).toContain("'email'")
  })

  test('includes hidden array', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain('static hidden')
    expect(stub).toContain("'password'")
  })

  test('does NOT add softDeletes when false', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).not.toContain('softDeletes')
  })

  test('adds softDeletes when true', () => {
    const postSchema = introspect(Post)
    const stub = generateModelStub(postSchema)
    expect(stub).toContain('static softDeletes = true')
  })

  test('includes detected casts in casts block', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain('is_admin')
    expect(stub).toContain('boolean')
  })

  test('includes relation stubs from detected relations', () => {
    const stub = generateModelStub(userSchema)
    expect(stub).toContain('posts()')
    expect(stub).toContain('hasMany')
    expect(stub).toContain('profile()')
    expect(stub).toContain('hasOne')
  })

  test('uses plain descriptor with empty casts gracefully', () => {
    const stub = generateModelStub(introspect(plainDescriptor))
    expect(stub).toContain('class Category extends Model')
    expect(stub).toContain("static table    = 'categories'")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateMigrationStub — smart template + from schema
// ─────────────────────────────────────────────────────────────────────────────
describe('generateMigrationStub', () => {
  test('create_ name → CREATE TABLE template', () => {
    const stub = generateMigrationStub('create_users_table')
    expect(stub).toContain("Schema.create('users'")
    expect(stub).toContain('async up()')
    expect(stub).toContain("Schema.dropIfExists('users')")
  })

  test('add_ name → ALTER TABLE ADD template', () => {
    const stub = generateMigrationStub('add_avatar_to_users')
    expect(stub).toContain("Schema.table('users'")
  })

  test('drop_ column name → ALTER TABLE DROP template', () => {
    const stub = generateMigrationStub('drop_bio_from_profiles')
    expect(stub).toContain("Schema.table('profiles'")
    expect(stub).toContain('dropColumn')
  })

  test('rename_ name → RENAME template', () => {
    const stub = generateMigrationStub('rename_posts_to_articles')
    expect(stub).toContain("Schema.rename('posts', 'articles')")
  })

  test('generic name → generic template', () => {
    const stub = generateMigrationStub('custom_operation')
    expect(stub).toContain('async up()')
    expect(stub).toContain('async down()')
  })

  test('generates from schema with typed columns', () => {
    const schema = introspect(plainDescriptor)
    const stub   = generateMigrationStub('create_categories_table', schema)
    expect(stub).toContain("Schema.create('categories'")
    expect(stub).toContain('t.id()')
    expect(stub).toContain("t.string('name')")
    expect(stub).toContain("t.string('slug')")
    expect(stub).toContain('t.timestamps()')
  })

  test('schema-based migration includes softDeletes column', () => {
    const postSchema = introspect(Post)
    const stub = generateMigrationStub('create_posts_table', postSchema)
    expect(stub).toContain('t.softDeletes()')
  })

  test('PascalCase class name generated from snake_case', () => {
    const stub = generateMigrationStub('create_user_profiles_table')
    expect(stub).toContain('class CreateUserProfilesTable extends Migration')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateFactoryStub
// ─────────────────────────────────────────────────────────────────────────────
describe('generateFactoryStub', () => {
  let userSchema

  beforeAll(() => { userSchema = introspect(User) })

  test('generates factory class name', () => {
    const stub = generateFactoryStub(userSchema)
    expect(stub).toContain('class UserFactory extends Factory')
  })

  test('imports faker', () => {
    const stub = generateFactoryStub(userSchema)
    expect(stub).toContain("from '@faker-js/faker'")
  })

  test('imports the model', () => {
    const stub = generateFactoryStub(userSchema)
    expect(stub).toContain("import User from '../models/User.js'")
  })

  test('sets model property', () => {
    const stub = generateFactoryStub(userSchema)
    expect(stub).toContain('model = User')
  })

  test('includes faker hints for known field names', () => {
    const stub = generateFactoryStub(userSchema)
    // name and email fields should have faker hints
    expect(stub).toContain('faker.person')
    expect(stub).toContain('faker.internet.email()')
  })

  test('definition() method is present', () => {
    const stub = generateFactoryStub(userSchema)
    expect(stub).toContain('definition()')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateSeederStub
// ─────────────────────────────────────────────────────────────────────────────
describe('generateSeederStub', () => {
  test('generates seeder class name', () => {
    const stub = generateSeederStub(introspect(User))
    expect(stub).toContain('class UserSeeder extends Seeder')
  })

  test('imports and uses the factory', () => {
    const stub = generateSeederStub(introspect(User))
    expect(stub).toContain('UserFactory')
    expect(stub).toContain('.create()')
  })

  test('has run() method', () => {
    const stub = generateSeederStub(introspect(User))
    expect(stub).toContain('async run()')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Integration: introspect → generateGraphqlSDL consistency
// ─────────────────────────────────────────────────────────────────────────────
describe('introspect → SDL integration', () => {
  test('schema fields align with SDL type fields', () => {
    const schema = introspect(User)
    const { typeDef } = generateGraphqlSDL(schema)
    const visibleFields = schema.fields.filter(f => !schema.graphql.hidden.has(f.name))
    for (const f of visibleFields) {
      expect(typeDef).toContain(f.name)
    }
  })

  test('hidden fields absent from both SDL type and inputs', () => {
    const schema = introspect(User)
    const { typeDef, inputCreate } = generateGraphqlSDL(schema)
    for (const hidden of schema.hidden) {
      expect(typeDef).not.toContain(hidden)
      expect(inputCreate).not.toContain(hidden)
    }
  })

  test('softDeletes mutations only when model has softDeletes', () => {
    const userSDL = generateGraphqlSDL(introspect(User))
    const postSDL = generateGraphqlSDL(introspect(Post))
    expect(userSDL.mutationLines.some(l => l.includes('restore'))).toBe(false)
    expect(postSDL.mutationLines.some(l => l.includes('restorePost'))).toBe(true)
  })
})
