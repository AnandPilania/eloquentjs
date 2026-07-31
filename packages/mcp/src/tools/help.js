/**
 * MCP Tools — Developer Help, Method Signatures, Examples, NLP Query & CRUD
 *
 * Lets AI agents look up how EloquentJS works, get real code examples,
 * and translate natural language into QueryBuilder chains or CRUD operations.
 */

// ─── Knowledge base ───────────────────────────────────────────────────────────
// Embedded docs so the tool works without internet access.

const TOPICS = {
  model: {
    summary: 'EloquentJS Model — base class for all ORM models.',
    description: `Models extend the Model base class and define table structure, relationships, casts, scopes, and lifecycle hooks.`,
    quickStart: `
class User extends Model {
  static table    = 'users'
  static fillable = ['name', 'email', 'password']
  static hidden   = ['password']
  static casts    = { is_admin: 'boolean', settings: 'json', born_at: 'date' }
  static softDeletes = true

  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role, 'user_roles') }

  getFullNameAttribute()  { return \`\${this.first_name} \${this.last_name}\` }
  setPasswordAttribute(v) { return bcrypt.hashSync(v, 10) }

  static scopeActive(qb) { return qb.where('active', true) }
  static async creating(user) { user.uuid = crypto.randomUUID() }
}`,
    seeAlso: ['query-builder', 'relations', 'casts', 'scopes', 'hooks'],
  },

  'query-builder': {
    summary: 'Fluent chainable query builder — reads like English.',
    description: 'All static Model methods return a QueryBuilder. Chain where/order/limit/with then await to get results.',
    quickStart: `
// Fetch
await User.all()
await User.find(1)
await User.findOrFail(1)
await User.where('active', true).with('posts').orderBy('name').paginate(1, 20)

// Conditions
await User.where('age', '>', 18).whereIn('role', ['admin', 'editor']).get()
await User.whereNull('deleted_at').whereBetween('score', [50, 100]).get()
await User.whereRaw('LOWER(email) = ?', ['alice@example.com']).first()

// Aggregates
await User.count()
await User.max('score')
await User.sum('balance')
await User.exists()

// Pagination
const page = await User.paginate(1, 20)
// { data: User[], meta: { total, per_page, current_page, last_page, has_more } }

// Mutations
await User.create({ name: 'Alice', email: 'a@b.com' })
await user.update({ name: 'Alicia' })
await user.delete()
await User.where('active', false).update({ notified: true })`,
    seeAlso: ['model', 'relations', 'scopes'],
  },

  relations: {
    summary: 'Define relationships between models — hasOne, hasMany, belongsTo, belongsToMany, morphTo, morphMany.',
    description: 'Relations are instance methods that return a relation builder. Eager load with .with() to avoid N+1.',
    quickStart: `
class Post extends Model {
  user()     { return this.belongsTo(User) }
  comments() { return this.hasMany(Comment) }
  tags()     { return this.belongsToMany(Tag, 'post_tags') }
  image()    { return this.morphOne(Image, 'imageable') }
}

// Eager loading
await User.with('posts', 'profile').get()
await User.with('posts.comments.author').get()
await User.with({ posts: qb => qb.where('published', true) }).get()

// BelongsToMany pivot
await user.roles().attach(roleId, { assigned_at: new Date() })
await user.roles().detach(roleId)
await user.roles().sync([1, 2, 3])
const roles = await user.roles()
console.log(roles[0]._pivot.assigned_at)`,
    seeAlso: ['model', 'query-builder'],
  },

  casts: {
    summary: 'Automatically cast attributes to/from JS types when reading or writing.',
    description: 'Declare static casts = {} on your model. Built-in: boolean, integer, float, decimal:N, string, json, array, date, datetime.',
    quickStart: `
class Product extends Model {
  static casts = {
    price:       'decimal:2',
    in_stock:    'boolean',
    launched_at: 'date',
    metadata:    'json',
    tags:        'array',
  }
}

// Custom cast class
class EncryptedCast {
  get(value)       { return decrypt(value) }
  set(value)       { return encrypt(value) }
  serialize(value) { return decrypt(value) }
}

class Secret extends Model {
  static casts = { api_key: EncryptedCast }
}`,
    seeAlso: ['model'],
  },

  scopes: {
    summary: 'Local and global query scopes for reusable WHERE conditions.',
    description: 'Local scopes are static methods prefixed scopeXxx. Call via withScopes() proxy. Global scopes are always applied.',
    quickStart: `
class User extends Model {
  static scopeActive(qb)         { return qb.where('active', true) }
  static scopeOlderThan(qb, age) { return qb.where('age', '>', age) }

  static globalScopes = {
    tenanted: qb => qb.where('tenant_id', getCurrentTenant()),
  }
}

import { withScopes } from '@eloquentjs/core'
const ScopedUser = withScopes(User)

await ScopedUser.active().get()
await ScopedUser.olderThan(18).get()
await User.withoutGlobalScope('tenanted').get()`,
    seeAlso: ['model', 'query-builder'],
  },

  hooks: {
    summary: 'Model lifecycle hooks — run code before/after create, update, delete.',
    description: 'Define static async methods on the model class or register with HookRegistry.observe(). All hooks are awaited.',
    quickStart: `
class User extends Model {
  static async creating(user) { user.uuid = crypto.randomUUID() }
  static async created(user)  { await WelcomeEmail.send(user) }
  static async updating(user) { }
  static async updated(user)  { await invalidateCache(user) }
  static async deleting(user) { await user.posts().delete() }
  static async deleted(user)  { }
}

// Observer class
class PostObserver {
  creating(post) { post.slug = slugify(post.title) }
  created(post)  { notifyFollowers(post) }
}
HookRegistry.observe(Post, new PostObserver())`,
    seeAlso: ['model', 'events'],
  },

  events: {
    summary: 'Global async event bus — listen to model lifecycle events from anywhere.',
    description: 'EventEmitter.on() subscribes globally. Returns an unsubscribe function. All listeners are awaited.',
    quickStart: `
import { EventEmitter } from '@eloquentjs/core'

// Subscribe
const unsub = EventEmitter.on('User:created', async (user) => {
  await AuditLog.create({ action: 'user.created', target_id: user.id })
})

// Once
EventEmitter.once('Post:published', async (post) => {
  await notifySubscribers(post)
})

// Emit manually
await EventEmitter.emit('custom:event', { data: 123 })

// Clean up
unsub()
EventEmitter.flush('User:created')`,
    seeAlso: ['hooks', 'model'],
  },

  'soft-deletes': {
    summary: 'Soft delete — sets deleted_at instead of removing rows.',
    description: 'Set static softDeletes = true. delete() sets deleted_at. forceDelete() removes permanently. withTrashed()/onlyTrashed() for querying.',
    quickStart: `
class Post extends Model {
  static softDeletes = true
}

await post.delete()           // sets deleted_at = now
await post.restore()          // clears deleted_at
await post.forceDelete()      // permanent delete

await Post.all()              // excludes soft-deleted
await Post.withTrashed().get() // includes soft-deleted
await Post.onlyTrashed().get() // only soft-deleted
await Post.where('id', 1).withTrashed().first()`,
    seeAlso: ['model', 'query-builder'],
  },

  validation: {
    summary: 'Validate any data with Laravel-style rules, fluent schema API, and async DB checks.',
    description: 'Use @eloquentjs/validator for full validation. Core Validator handles simple sync cases.',
    quickStart: `
import { Validator } from '@eloquentjs/validator'
import { v, Rule } from '@eloquentjs/validator'

// Laravel-style rules
const validator = Validator.make(data, {
  name:  ['required', 'string', 'min:2', 'max:100'],
  email: ['required', 'email', Rule.unique('users', 'email')],
  age:   ['required', 'integer', 'min:18'],
})
const result = await validator.validatedAsync()

// Fluent schema API
const schema = v.schema({
  name:  v.string().min(2).max(100),
  email: v.string().email(),
  age:   v.number().integer().min(18).optional(),
  role:  v.string().oneOf(['admin', 'editor']),
})

const data = schema.parse(req.body)          // throws on invalid
const { success, data, errors } = schema.safeParse(req.body)`,
    seeAlso: ['model', 'api'],
  },

  migrations: {
    summary: 'Database migrations — version-controlled schema changes.',
    description: 'Migration files in database/migrations/. Run with `eloquent migrate`. Track with `_migrations` table.',
    quickStart: `
import { Migration, Schema } from '@eloquentjs/core'

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create('users', t => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.boolean('is_active').default(true)
      t.json('settings').nullable()
      t.foreignId('role_id').constrained('roles')
      t.timestamps()
      t.softDeletes()
    })
  }

  async down() {
    await Schema.dropIfExists('users')
  }
}

// CLI commands
// eloquent migrate           — run pending
// eloquent migrate:rollback  — rollback last batch
// eloquent migrate:fresh     — drop all + re-run
// eloquent migrate:status    — see what's run`,
    seeAlso: ['query-builder'],
  },

  graphql: {
    summary: 'Auto-generate GraphQL schema + resolvers from models.',
    description: 'buildSchema([...Models]) returns { typeDefs, resolvers }. Works with Apollo, Yoga, Mercurius.',
    quickStart: `
import { buildSchema, buildSchemaFromDir } from '@eloquentjs/graphql'

// From model classes
const { typeDefs, resolvers } = buildSchema([User, Post, Comment], {
  pagination:    'offset',
  subscriptions: true,
  auth: async (ctx) => User.where('token', ctx.token).first(),
})

// From directory (auto-loads all models)
const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models')

// Per-model config
class Post extends Model {
  static graphql = {
    fields:       { secret: false },
    subscription: false,
    middleware:   [requireAuth],
  }
}

// CLI generation
// eloquent generate:graphql --out=schema.graphql`,
    seeAlso: ['model', 'api'],
  },

  api: {
    summary: 'One-line auto-CRUD REST routes for Express and Fastify.',
    description: 'resource(ModelClass, opts) + apiRouter([...]) generates GET/POST/PUT/PATCH/DELETE routes with filtering, sorting, pagination.',
    quickStart: `
import { apiRouter, resource } from '@eloquentjs/api'

app.use('/api', apiRouter([
  resource(User, {
    middleware:  [authRequired],
    with:        ['profile'],
    searchable:  ['name', 'email'],
    sortable:    ['name', 'created_at'],
    policy: async (req, model, action) => {
      if (action === 'destroy') return req.user.is_admin
      return true
    },
  }),
  resource(Post, { only: ['index', 'show', 'store'] }),
]))

// Generated routes:
// GET    /api/users?page=1&per_page=20&search=alice&sort=-created_at
// POST   /api/users
// GET    /api/users/:id?with=profile,posts
// PUT    /api/users/:id
// DELETE /api/users/:id`,
    seeAlso: ['model', 'graphql', 'validation'],
  },

  realtime: {
    summary: 'WebSocket pub/sub — auto-broadcast model lifecycle events.',
    description: 'Pusher-protocol compatible. Works with Laravel Echo, Pusher JS client, or the built-in RealtimeClient.',
    quickStart: `
import { createRealtimeServer } from '@eloquentjs/realtime'

// Server
const rt = createRealtimeServer({ port: 6001 })
rt.broadcastFrom(User)   // broadcasts User:created/updated/deleted
rt.broadcastFrom(Post, { events: ['created'], transform: p => ({ id: p.id, title: p.title }) })
rt.broadcast('notifications', 'alert', { message: 'Server deployed' })

// Client
import { RealtimeClient } from '@eloquentjs/realtime'
const client = new RealtimeClient('ws://localhost:6001')
client.subscribe('users')
  .on('created', user => console.log('New user:', user))
  .on('updated', user => renderCard(user))
client.private('orders.123').on('updated', o => refreshOrder(o))`,
    seeAlso: ['model', 'events'],
  },

  mcp: {
    summary: 'MCP server for AI agents — exposes EloquentJS to Claude, Cursor, Windsurf.',
    description: 'Runs as a stdio server. Configure in your AI tool settings. Provides 21 tools for introspection, generation, querying, and help.',
    quickStart: `
# Install
npm install -g @eloquentjs/mcp

# Claude Desktop (~/.claude/mcp_config.json)
{
  "mcpServers": {
    "eloquentjs": {
      "command": "npx",
      "args": ["@eloquentjs/mcp", "--cwd", "/path/to/project"]
    }
  }
}

# Cursor — Settings > MCP Servers
{
  "name": "eloquentjs",
  "command": "eloquent-mcp --cwd \${workspaceFolder}"
}

# Tools available:
# list_models, describe_model, generate_model, generate_migration,
# query_model, run_migrations, get_help, nlp_query, nlp_crud, ...`,
    seeAlso: ['model', 'query-builder', 'migrations'],
  },
}

// ─── Method signature database ────────────────────────────────────────────────

const METHOD_SIGNATURES = {
  // Model static
  'Model.find':         { sig: 'find(id)',                        returns: 'Promise<Model|null>',    desc: 'Find by primary key. Returns null if not found.' },
  'Model.findOrFail':   { sig: 'findOrFail(id)',                  returns: 'Promise<Model>',          desc: 'Find by PK or throw ModelNotFoundException.' },
  'Model.findMany':     { sig: 'findMany(ids[])',                  returns: 'Promise<Collection>',     desc: 'Find multiple records by PK array.' },
  'Model.all':          { sig: 'all()',                           returns: 'Promise<Collection>',     desc: 'Fetch all records.' },
  'Model.first':        { sig: 'first()',                         returns: 'Promise<Model|null>',    desc: 'Fetch first record.' },
  'Model.firstOrFail':  { sig: 'firstOrFail()',                   returns: 'Promise<Model>',          desc: 'Fetch first or throw.' },
  'Model.create':       { sig: 'create(data{})',                  returns: 'Promise<Model>',          desc: 'Create and save a new record.' },
  'Model.updateOrCreate': { sig: 'updateOrCreate(where{}, data{})', returns: 'Promise<Model>',       desc: 'Update if exists, create otherwise.' },
  'Model.firstOrCreate': { sig: 'firstOrCreate(where{}, data{})', returns: 'Promise<Model>',         desc: 'Find first matching or create.' },
  'Model.query':        { sig: 'query()',                         returns: 'QueryBuilder',            desc: 'Start a new query builder chain.' },
  'Model.where':        { sig: 'where(field, op?, value)',         returns: 'QueryBuilder',            desc: 'Add WHERE condition. Op defaults to "=".' },
  'Model.with':         { sig: 'with(...relations | {rel: qb})',  returns: 'QueryBuilder',            desc: 'Eager load relations.' },
  'Model.paginate':     { sig: 'paginate(page, perPage)',          returns: 'Promise<{data,meta}>',   desc: 'Paginate results. meta has total, per_page, current_page.' },
  'paginate':           { sig: 'paginate(page, perPage)',          returns: 'Promise<{data,meta}>',   desc: 'Paginate results. meta has total, per_page, current_page.' },
  'Model.chunk':        { sig: 'chunk(size, callback)',            returns: 'Promise<void>',          desc: 'Process records in batches to save memory.' },
  'Model.count':        { sig: 'count(col?)',                     returns: 'Promise<number>',         desc: 'Count matching records.' },
  'Model.exists':       { sig: 'exists()',                        returns: 'Promise<boolean>',        desc: 'Check if any matching records exist.' },
  'Model.withTrashed':  { sig: 'withTrashed()',                   returns: 'QueryBuilder',            desc: 'Include soft-deleted records (requires softDeletes=true).' },
  'Model.onlyTrashed':  { sig: 'onlyTrashed()',                   returns: 'QueryBuilder',            desc: 'Only soft-deleted records.' },
  // Model instance
  'model.save':         { sig: 'save()',                          returns: 'Promise<Model>',          desc: 'Persist changes to the database.' },
  'model.update':       { sig: 'update(data{})',                  returns: 'Promise<Model>',          desc: 'Mass-assign and save.' },
  'model.delete':       { sig: 'delete()',                        returns: 'Promise<void>',           desc: 'Soft delete (if enabled) or hard delete.' },
  'model.forceDelete':  { sig: 'forceDelete()',                   returns: 'Promise<void>',           desc: 'Hard delete regardless of softDeletes.' },
  'model.restore':      { sig: 'restore()',                       returns: 'Promise<Model>',          desc: 'Restore a soft-deleted record.' },
  'model.toJSON':       { sig: 'toJSON()',                        returns: 'object',                  desc: 'Serialize to plain object (respects hidden, appends, casts).' },
  'model.isDirty':      { sig: 'isDirty(field?)',                 returns: 'boolean',                 desc: 'Check if any (or specific) attribute has changed.' },
  'model.getDirty':     { sig: 'getDirty()',                      returns: 'object',                  desc: 'Get all changed attributes as {field: newValue}.' },
  'model.getOriginal':  { sig: 'getOriginal(field?)',             returns: 'any|object',              desc: 'Get original value(s) before modification.' },
  // Relations
  'hasMany':            { sig: 'hasMany(Related, fk?, pk?)',      returns: 'Relation',                desc: 'One-to-many. E.g. User has many Posts.' },
  'hasOne':             { sig: 'hasOne(Related, fk?, pk?)',       returns: 'Relation',                desc: 'One-to-one. E.g. User has one Profile.' },
  'belongsTo':          { sig: 'belongsTo(Related, fk?, pk?)',    returns: 'Relation',                desc: 'Inverse of hasMany/hasOne.' },
  'belongsToMany':      { sig: 'belongsToMany(Related, pivot?, fk?, rfk?)', returns: 'Relation',     desc: 'Many-to-many via pivot table.' },
  'morphMany':          { sig: 'morphMany(Related, morph)',       returns: 'Relation',                desc: 'Polymorphic one-to-many.' },
  'morphTo':            { sig: 'morphTo(morph)',                  returns: 'Relation',                desc: 'Polymorphic inverse.' },
}

// ─── Code examples database ───────────────────────────────────────────────────

const EXAMPLES = {
  pagination: `
// Basic pagination
const page = await User.paginate(1, 20)
// { data: User[], meta: { total, per_page, current_page, last_page, has_more } }

// With conditions
const page = await Post.where('status', 'published')
  .with('user', 'tags')
  .orderByDesc('created_at')
  .paginate(req.query.page ?? 1, 15)

// Access results
page.data.forEach(post => console.log(post.title))
console.log(page.meta.total)
console.log(page.meta.has_more)`,

  'eager-loading': `
// Load one relation
const users = await User.with('posts').get()

// Load multiple
const users = await User.with('posts', 'profile', 'roles').get()

// Nested (avoid N+1 at every level)
const users = await User.with('posts.comments.author').get()

// Constrained eager load
const users = await User.with({
  posts: qb => qb.where('published', true).orderByDesc('created_at').limit(5),
  roles: qb => qb.where('active', true),
}).get()

// Check if loaded
if (user.relationLoaded('posts')) {
  user.getRelation('posts').forEach(p => ...)
}`,

  transactions: `
import { transaction } from '@eloquentjs/pgsql'

// All operations share one connection.
// Any thrown error triggers automatic ROLLBACK.
await transaction(async () => {
  const user  = await User.create({ name: 'Alice', email: 'a@b.com' })
  const role  = await Role.where('name', 'admin').firstOrFail()
  await user.roles().attach(role.id)
  await user.profile().create({ bio: 'New user' })
  // If this throws → ROLLBACK is called automatically
})`,

  'soft-deletes': `
class Post extends Model {
  static softDeletes = true
}

await post.delete()            // sets deleted_at, NOT removed
await post.restore()           // clears deleted_at
await post.forceDelete()       // permanent removal

await Post.all()               // auto-excludes deleted
await Post.withTrashed().get() // includes deleted
await Post.onlyTrashed().get() // only deleted

// Scope to check
const post = await Post.withTrashed().find(id)
if (post.trashed()) console.log('soft-deleted')`,

  validation: `
import { v, Rule, Validator } from '@eloquentjs/validator'

// Schema API
const schema = v.schema({
  name:     v.string().min(2).max(100),
  email:    v.string().email().unique('users', 'email'),  // async DB check
  age:      v.number().integer().min(18).optional(),
  password: v.string().min(8).confirmed(),
  role:     v.string().oneOf(['admin', 'editor', 'viewer']),
})

// parse throws ValidationException on failure
try {
  const data = await schema.parseAsync(req.body)
} catch (err) {
  // err.errors = { email: ['has already been taken'], ... }
  res.status(422).json({ errors: err.errors })
}

// safeParse never throws
const { success, data, errors } = await schema.safeParseAsync(req.body)`,

  factory: `
import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'

class UserFactory extends Factory {
  model = User
  definition() {
    return {
      name:     faker.person.fullName(),
      email:    faker.internet.email(),
      password: 'password',
      is_admin: false,
    }
  }
  admin()    { return this.state({ is_admin: true }) }
  verified() { return this.state({ email_verified_at: new Date() }) }
}

// In tests
const user  = await UserFactory.new().create()
const admin = await UserFactory.new().admin().verified().create()
const users = await UserFactory.new().count(20).create()`,
}

// ─── NLP parser helpers ───────────────────────────────────────────────────────

function parseNlpQuery(text) {
  const t = text.toLowerCase()
  const result = { model: null, conditions: [], orderBy: null, limit: null, with: [], aggregate: null }

  // Extract model name
  const modelMatch = text.match(/\b([A-Z][a-zA-Z]+)\b/)
  if (modelMatch) result.model = modelMatch[1]

  // Simple condition patterns
  if (t.includes('active') || t.includes('enabled'))      result.conditions.push({ field: 'active', op: '=', value: true })
  if (t.includes('admin'))                                 result.conditions.push({ field: 'is_admin', op: '=', value: true })
  if (t.includes('deleted') || t.includes('trashed'))     result.softDeleted = true

  // Limit extraction — try various patterns
  const lastN   = t.match(/\blast\s+(\d+)\b/)
  const firstN  = t.match(/\bfirst\s+(\d+)\b/)
  const topN    = t.match(/\btop\s+(\d+)\b/)
  const nMost   = t.match(/\b(\d+)\s+most\b/)   // "10 most recent"
  const getN    = t.match(/\bget\s+(\d+)\b/)     // "get 5 ..."
  const limitN  = lastN || firstN || topN || nMost || getN
  if (limitN) result.limit = parseInt(limitN[1])

  if (t.includes('recent') || t.includes('latest') || t.includes('newest')) result.orderBy = { field: 'created_at', dir: 'desc' }
  if (t.includes('oldest'))                               result.orderBy = { field: 'created_at', dir: 'asc' }
  if (t.includes('alphabetical') || t.includes('by name')) result.orderBy = { field: 'name', dir: 'asc' }
  if (t.includes('count') || t.includes('how many'))      result.aggregate = 'count'
  if (t.includes('with post') || t.includes('with their post'))  result.with.push('posts')
  if (t.includes('with profile'))                          result.with.push('profile')
  if (t.includes('with comment'))                          result.with.push('comments')
  if (t.includes('with role'))                             result.with.push('roles')
  if (t.includes('this week')) {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    result.conditions.push({ field: 'created_at', op: '>=', value: weekAgo })
  }
  if (t.includes('today')) {
    const today = new Date().toISOString().slice(0, 10)
    result.conditions.push({ field: 'created_at', op: '>=', value: today })
  }

  return result
}

function buildQueryCode(parsed) {
  if (!parsed.model) return null

  const lines = [`${parsed.model}`]
  if (parsed.softDeleted) lines[0] += '.withTrashed()'
  for (const c of parsed.conditions) {
    const val = typeof c.value === 'string' ? `'${c.value}'` : c.value
    if (c.op === '=') lines.push(`.where('${c.field}', ${val})`)
    else lines.push(`.where('${c.field}', '${c.op}', ${val})`)
  }
  if (parsed.with.length) lines.push(`.with(${parsed.with.map(r => `'${r}'`).join(', ')})`)
  if (parsed.orderBy) lines.push(`.orderBy('${parsed.orderBy.field}', '${parsed.orderBy.dir}')`)
  if (parsed.limit) lines.push(`.limit(${parsed.limit})`)
  if (parsed.aggregate === 'count') lines.push('.count()')
  else lines.push('.get()')

  return `await ${lines.join('\n  ')}`
}

function parseNlpCrud(text) {
  const t = text.toLowerCase()

  if (t.startsWith('create') || t.startsWith('add') || t.startsWith('insert') || t.startsWith('new')) {
    return { operation: 'create', text }
  }
  if (t.startsWith('update') || t.startsWith('change') || t.startsWith('set') || t.startsWith('modify')) {
    return { operation: 'update', text }
  }
  if (t.startsWith('delete') || t.startsWith('remove') || t.startsWith('destroy')) {
    return { operation: 'delete', text }
  }
  if (t.startsWith('find') || t.startsWith('get') || t.startsWith('show') || t.startsWith('fetch')) {
    return { operation: 'find', text }
  }
  return { operation: 'unknown', text }
}

// ─── Tool definitions ──────────────────────────────────────────────────────────

export const helpTools = [
  {
    name: 'get_help',
    description: 'Get documentation, usage guide, and examples for any EloquentJS topic. Topics: model, query-builder, relations, casts, scopes, hooks, events, soft-deletes, validation, migrations, graphql, api, realtime, mcp.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Topic to get help for. E.g. "model", "query-builder", "relations", "soft-deletes", "graphql", "validation".',
        },
        search: {
          type: 'string',
          description: 'Search term to find the right topic (if you\'re unsure of the exact topic name).',
        },
      },
    },
  },
  {
    name: 'get_method_signature',
    description: 'Get the exact method signature, return type, and description for any EloquentJS method. E.g. "Model.find", "model.update", "hasMany", "paginate".',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Method name. E.g. "Model.find", "model.update", "hasMany", "belongsToMany", "paginate".',
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'get_examples',
    description: 'Get working, copy-paste ready code examples for common EloquentJS patterns. Topics: pagination, eager-loading, transactions, soft-deletes, validation, factory.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'What pattern to show examples for. E.g. "pagination", "eager-loading", "transactions", "soft-deletes", "validation", "factory".',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'nlp_query',
    description: 'Convert a natural language description into an EloquentJS QueryBuilder chain. E.g. "get the 10 most recent active users with their posts".',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query description. E.g. "get active users created this week", "find the 5 most recent posts with their comments", "count all admin users".',
        },
        execute: {
          type: 'boolean',
          default: false,
          description: 'If true, also execute the query and return results (requires DB connection).',
        },
        modelsDir: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'nlp_crud',
    description: 'Convert a natural language CRUD description into EloquentJS code. E.g. "create a user named Alice with email alice@example.com and role admin".',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'Natural language CRUD instruction. E.g. "create a post titled Hello World with body Lorem ipsum", "update user 42 set is_admin to true", "delete all posts older than 30 days".',
        },
        execute: {
          type: 'boolean',
          default: false,
          description: 'If true, execute the operation (requires DB connection and write permissions).',
        },
        modelsDir: { type: 'string' },
      },
      required: ['instruction'],
    },
  },
]

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function handleGetHelp(args, ctx) {
  // Search mode
  if (args.search && !args.topic) {
    const search = args.search.toLowerCase()
    const matches = Object.entries(TOPICS)
      .filter(([key, val]) =>
        key.includes(search) ||
        val.summary.toLowerCase().includes(search) ||
        val.description.toLowerCase().includes(search)
      )
      .map(([key, val]) => ({ topic: key, summary: val.summary }))

    return {
      searchTerm: args.search,
      matches,
      hint: matches.length > 0
        ? `Call get_help with topic: "${matches[0].topic}" for full details.`
        : `No matches found. Available topics: ${Object.keys(TOPICS).join(', ')}`,
    }
  }

  const topic = args.topic?.toLowerCase()
  const doc   = TOPICS[topic]

  if (!doc) {
    return {
      error:           `Topic "${args.topic}" not found.`,
      availableTopics: Object.keys(TOPICS),
      hint:            'Use the search parameter to find topics by keyword.',
    }
  }

  return {
    topic,
    summary:     doc.summary,
    description: doc.description,
    quickStart:  doc.quickStart.trim(),
    seeAlso:     doc.seeAlso,
  }
}

export async function handleGetMethodSignature(args, ctx) {
  const key = args.method
  // Try exact match first
  if (METHOD_SIGNATURES[key]) {
    return { method: key, ...METHOD_SIGNATURES[key] }
  }

  // Fuzzy match
  const search  = key.toLowerCase()
  const matches = Object.entries(METHOD_SIGNATURES)
    .filter(([k]) => k.toLowerCase().includes(search))
    .map(([k, v]) => ({ method: k, signature: v.sig, returns: v.returns, description: v.desc }))

  if (matches.length === 1) return { method: matches[0].method, ...matches[0] }
  if (matches.length > 1)  return { matches, hint: 'Multiple matches found. Be more specific.' }

  return {
    error:   `Method "${args.method}" not found.`,
    hint:    'Try: Model.find, model.update, hasMany, paginate, belongsToMany, etc.',
    allMethods: Object.keys(METHOD_SIGNATURES),
  }
}

export async function handleGetExamples(args, ctx) {
  const topic = args.topic?.toLowerCase().replace(/\s+/g, '-')
  const code  = EXAMPLES[topic]

  if (!code) {
    return {
      error:            `No examples for "${args.topic}".`,
      availableTopics: Object.keys(EXAMPLES),
    }
  }

  return {
    topic,
    code: code.trim(),
    hint: 'Copy-paste ready. Adjust model names and field names to match your schema.',
  }
}

export async function handleNlpQuery(args, ctx) {
  const parsed = parseNlpQuery(args.query)
  const code   = buildQueryCode(parsed)

  if (!code || !parsed.model) {
    return {
      error:       'Could not parse query. Please include a model name (e.g. "User", "Post").',
      parsed,
      suggestions: [
        'get the 10 most recent active users',
        'find all posts created this week with their comments',
        'count admin users',
        'get users with their posts ordered by name',
      ],
    }
  }

  const result = {
    naturalLanguage: args.query,
    generatedCode:   code,
    parsed,
  }

  if (args.execute) {
    try {
      const { loadModelsByName } = await import('@eloquentjs/codegen/render')
      const { resolveConfig }    = await import('@eloquentjs/cli/utils')
      const { resolve }          = await import('path')
      const cfg                  = resolveConfig(ctx)
      const dir                  = resolve(ctx.cwd, args.modelsDir ?? cfg.paths.models)
      const [ModelClass]         = await loadModelsByName(dir, [parsed.model])

      let qb = ModelClass.query()
      for (const c of parsed.conditions) qb = qb.where(c.field, c.op === '=' ? c.value : [c.op, c.value])
      if (parsed.with.length)  qb = qb.with(...parsed.with)
      if (parsed.orderBy)      qb = qb.orderBy(parsed.orderBy.field, parsed.orderBy.dir)
      if (parsed.limit)        qb = qb.limit(Math.min(parsed.limit, 50))

      let data
      if (parsed.aggregate === 'count') {
        data = await qb.count()
      } else {
        const rows = await qb.get()
        data = (rows.toArray ? rows.toArray() : rows).map(r => r.toJSON ? r.toJSON() : r)
      }

      result.executed = true
      result.data     = data
      result.count    = Array.isArray(data) ? data.length : data
    } catch (err) {
      result.executeError = err.message
    }
  }

  return result
}

export async function handleNlpCrud(args, ctx) {
  const parsed = parseNlpCrud(args.instruction)
  const text   = args.instruction

  // Build a code suggestion based on the instruction
  let code = '// Could not generate code from this instruction.\n'
  let explanation = ''

  const modelMatch = text.match(/\b([A-Z][a-zA-Z]+)\b/)
  const modelName  = modelMatch?.[1] ?? 'Model'

  switch (parsed.operation) {
    case 'create': {
      // Extract key=value pairs from text
      const pairs = {}
      const kvMatches = text.matchAll(/(\w+)\s+(?:=|:|\bnamed\b|\bwith\b)\s+"?([^",]+)"?/gi)
      for (const m of kvMatches) pairs[m[1].toLowerCase()] = m[2].trim()
      // Also handle "named X" and "with email Y" patterns
      const namedMatch = text.match(/named\s+"?([^",\s]+)"?/i)
      const emailMatch = text.match(/email\s+"?([^\s,]+)"?/i)
      if (namedMatch) pairs['name'] = namedMatch[1]
      if (emailMatch) pairs['email'] = emailMatch[1]

      const dataStr = Object.keys(pairs).length > 0
        ? '{\n' + Object.entries(pairs).map(([k,v]) => `  ${k}: '${v}'`).join(',\n') + '\n}'
        : '{ /* add fields here */ }'
      code = `const record = await ${modelName}.create(${dataStr})`
      explanation = `Creates a new ${modelName} record.`
      break
    }
    case 'update': {
      const idMatch = text.match(/\b(?:id\s+)?(\d+)\b/)
      const id      = idMatch?.[1] ?? 'id'
      code = `const record = await ${modelName}.findOrFail(${id})\nawait record.update({ /* fields to change */ })`
      explanation = `Updates ${modelName} with id ${id}.`
      break
    }
    case 'delete': {
      const idMatch = text.match(/\b(?:id\s+)?(\d+)\b/)
      if (idMatch) {
        code = `const record = await ${modelName}.findOrFail(${idMatch[1]})\nawait record.delete()`
        explanation = `Soft-deletes (or hard-deletes) ${modelName} with id ${idMatch[1]}.`
      } else {
        code = `await ${modelName}.where(/* condition */).delete()`
        explanation = `Mass delete matching ${modelName} records.`
      }
      break
    }
    case 'find': {
      const idMatch = text.match(/\b(?:id\s+)?(\d+)\b/)
      if (idMatch) {
        code = `const record = await ${modelName}.findOrFail(${idMatch[1]})`
        explanation = `Find ${modelName} by id ${idMatch[1]}.`
      } else {
        code = `const records = await ${modelName}.where(/* condition */).get()`
        explanation = `Find matching ${modelName} records.`
      }
      break
    }
  }

  const result = {
    instruction:   args.instruction,
    operation:     parsed.operation,
    generatedCode: code,
    explanation,
    note: 'Review and adjust field names/values before executing.',
  }

  if (args.execute && parsed.operation !== 'unknown') {
    result.warning = 'Execute mode for CRUD is disabled by default for safety. Remove this warning and add --confirm flag to enable.'
  }

  return result
}
