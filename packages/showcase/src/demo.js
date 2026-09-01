/**
 * Real-world consumer demo — wires together every EloquentJS package against
 * one driver, following each package's README. Run with:
 *
 *   node src/demo.js sqlite
 *   node src/demo.js pgsql
 *   node src/demo.js mongodb
 *
 * Each section is independent and reports pass/fail so one broken section
 * doesn't stop the rest from being exercised.
 */

import { resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import http from 'http'
import { setTimeout as sleep } from 'timers/promises'

const driver = process.argv[2] ?? process.env.DB_DRIVER ?? 'sqlite'
process.env.DB_DRIVER = driver

const results = []
async function section(name, fn) {
  process.stdout.write(`\n▶ ${name}\n`)
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ✔ ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err })
    console.error(`  ✖ ${name}: ${err.stack ?? err.message}`)
  }
}

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const cwd = resolve(__dirname, '..')

// ─── 1. Connect the driver ──────────────────────────────────────────────────
const { default: config } = await import(pathToFileURL(resolve(cwd, 'eloquent.config.js')).href)

// `driver` routes which package to load — it isn't a connection option for
// any of them (MongoClient rejects an unrecognized option outright).
const { driver: _driver, ...connectionOptions } = config.connection

if (driver === 'sqlite') {
  const { connect } = await import('@eloquentjs/sqlite')
  await connect({ filename: connectionOptions.database })
} else if (driver === 'pgsql') {
  const { connect } = await import('@eloquentjs/pgsql')
  await connect(connectionOptions)
} else if (driver === 'mongodb') {
  const { connect } = await import('@eloquentjs/mongodb')
  await connect(connectionOptions)
} else {
  throw new Error(`Unknown driver: ${driver}`)
}

const { User, Profile, Post, Comment, Tag, Role, Country } = await import(pathToFileURL(resolve(cwd, 'app/models/index.js')).href)
const supportsJoins = driver !== 'mongodb'

// ─── 2. Core: CRUD, relations, casts, soft deletes ──────────────────────────
await section('core — CRUD, relations, casts, soft deletes', async () => {
  const bob = await User.where('email', 'bob@example.com').firstOrFail()
  if (typeof bob.is_admin !== 'boolean') throw new Error(`is_admin cast failed: ${typeof bob.is_admin}`)
  if ('password' in bob.toJSON()) throw new Error('hidden field leaked into toJSON()')

  const posts = await bob.posts().get()
  if (posts.length < 2) throw new Error(`expected bob to have posts, got ${posts.length}`)

  const withProfile = await User.with('profile').where('email', 'bob@example.com').first()
  if (!withProfile.profile) throw new Error('eager load of profile failed')

  const publishedCount = await Post.scope('published').count()
  if (publishedCount < 1) throw new Error('scopePublished returned nothing')

  // Soft delete round trip
  const draft = await Post.where('title', 'like', '%Draft%').first() ?? await Post.where('published', false).first()
  await draft.delete()
  const stillVisible = await Post.find(draft.id)
  if (stillVisible) throw new Error('soft-deleted post still visible via default query')
  const trashed = await Post.onlyTrashed().find(draft.id)
  if (!trashed) throw new Error('onlyTrashed() did not find the soft-deleted post')
  await trashed.restore()
  const restored = await Post.find(draft.id)
  if (!restored) throw new Error('restore() did not bring the post back')

  if (supportsJoins) {
    const uk = await Country.where('name', 'United Kingdom').firstOrFail()
    const ukPosts = await uk.posts().get()
    if (ukPosts.length < 2) throw new Error(`hasManyThrough returned ${ukPosts.length} posts, expected >= 2`)

    const roles = await bob.roles().get()
    if (roles.length < 1) throw new Error('belongsToMany roles() returned nothing')
  }
})

// ─── 3. Validator ───────────────────────────────────────────────────────────
await section('validator — sync + async DB-backed rules', async () => {
  const { Validator } = await import('@eloquentjs/validator')

  const bad = Validator.make({ name: 'x', email: 'not-an-email' }, {
    name:  ['required', 'string', 'min:2'],
    email: ['required', 'email'],
  })
  if (!bad.fails()) throw new Error('expected validation to fail for short name + bad email')

  const good = Validator.make({ name: 'Alice', email: 'new-user@example.com' }, {
    name:  ['required', 'string', 'min:2'],
    email: ['required', 'email', 'unique:users,email'],
  })
  if (await good.failsAsync()) throw new Error(`expected fresh email to pass unique check: ${JSON.stringify(good.errors)}`)

  const dup = Validator.make({ name: 'Alice', email: 'bob@example.com' }, {
    email: ['required', 'email', 'unique:users,email'],
  })
  if (!(await dup.failsAsync())) throw new Error('expected unique:users,email to reject an existing email')
})

// ─── 4. GraphQL — build schema from live models, execute a query ───────────
await section('graphql — buildSchema + graphql-js execution', async () => {
  const { buildSchema } = await import('@eloquentjs/graphql')
  const { graphql } = await import('graphql')
  const { makeExecutableSchema } = await tryImport('@graphql-tools/schema')

  const models = supportsJoins ? [User, Profile, Post, Comment, Tag, Role, Country] : [User, Profile, Post, Comment]
  const { typeDefs, resolvers } = buildSchema(models)

  const schema = makeExecutableSchema
    ? makeExecutableSchema({ typeDefs, resolvers })
    : await buildGraphQLSchemaWithoutTools(typeDefs, resolvers)

  const result = await graphql({
    schema,
    source: `query { users(perPage: 10) { data { name email } meta { total } } }`,
  })
  if (result.errors?.length) throw new Error(`GraphQL query errors: ${result.errors.map(e => e.message).join('; ')}`)
  if (!result.data.users.data.length) throw new Error('GraphQL users query returned no rows')

  const created = await graphql({
    schema,
    source: `mutation($input: CreatePostInput!) { createPost(input: $input) { id title } }`,
    variableValues: { input: { title: 'From GraphQL', user_id: (await User.first()).id, published: false } },
  })
  if (created.errors?.length) throw new Error(`GraphQL mutation errors: ${created.errors.map(e => e.message).join('; ')}`)
})

async function tryImport(name) {
  try { return await import(name) } catch { return {} }
}

// Minimal fallback: graphql-js's buildSchema(typeDefs) + attach resolvers by hand,
// used only if @graphql-tools/schema isn't installed.
async function buildGraphQLSchemaWithoutTools(typeDefs, resolvers) {
  const { buildSchema: buildSDLSchema } = await import('graphql')
  const schema = buildSDLSchema(typeDefs)
  for (const [typeName, fields] of Object.entries(resolvers)) {
    const type = schema.getType(typeName)
    if (!type?.getFields) continue
    const typeFields = type.getFields()
    for (const [fieldName, resolve] of Object.entries(fields)) {
      if (typeFields[fieldName]) typeFields[fieldName].resolve = resolve
    }
  }
  return schema
}

// ─── 5. REST API — @eloquentjs/api mounted on Express ──────────────────────
let apiServer
await section('api — @eloquentjs/api REST routes on Express', async () => {
  const express = (await import('express')).default
  const { apiRouter, resource } = await import('@eloquentjs/api')

  const app = express()
  app.use(express.json())
  app.use('/api', apiRouter([
    resource(User, { searchable: ['name', 'email'], sortable: ['name', 'created_at'] }),
    resource(Post, { searchable: ['title'], sortable: ['created_at'] }),
  ]))

  apiServer = await new Promise((res, rej) => {
    const s = app.listen(0, () => res(s))
    s.on('error', rej)
  })
  const port = apiServer.address().port

  const list = await fetchJson(`http://127.0.0.1:${port}/api/users`)
  if (!Array.isArray(list.data)) throw new Error(`GET /api/users did not return paginated data: ${JSON.stringify(list)}`)

  const createRes = await fetchJson(`http://127.0.0.1:${port}/api/posts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'From REST API', user_id: (await User.first()).id }),
  })
  if (!createRes.id) throw new Error(`POST /api/posts did not create a row: ${JSON.stringify(createRes)}`)
})

function fetchJson(url, opts) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(url, { method: opts?.method ?? 'GET', headers: opts?.headers }, res => {
      let body = ''
      res.on('data', c => (body += c))
      res.on('end', () => {
        try { resolvePromise(JSON.parse(body)) } catch (e) { reject(new Error(`bad JSON from ${url}: ${body}`)) }
      })
    })
    req.on('error', reject)
    if (opts?.body) req.write(opts.body)
    req.end()
  })
}

// ─── 6. Realtime — server + client round trip ──────────────────────────────
await section('realtime — WebSocket broadcast round trip', async () => {
  const { createRealtimeServer } = await import('@eloquentjs/realtime')
  const { RealtimeClient } = await import('@eloquentjs/realtime/client')

  const rt = createRealtimeServer({ port: 0, appKey: 'showcase-key', appSecret: 'showcase-secret' })
  rt.broadcastFrom(User)
  // No public API exposes the bound port (needed here since :0 picks a free
  // one) — reach into the internal http.Server the same way the library does.
  const port = rt._httpServer?.address?.()?.port
  if (!port) throw new Error('could not determine realtime server port')

  const client = new RealtimeClient(`ws://127.0.0.1:${port}`)
  const received = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('timed out waiting for broadcast')), 5000)
    client.subscribe('users').on('created', user => {
      clearTimeout(timer)
      res(user)
    })
    sleep(200).then(() => User.create({ name: 'Realtime User', email: `rt-${Date.now()}@example.com`, password: 'x' }))
  })
  if (!received?.name) throw new Error('did not receive broadcast payload')

  client.disconnect()
  await rt.close()
})

// ─── 7. MCP — call tool handlers directly (same code the stdio server uses) ─
await section('mcp — tool handlers (list_models, query_model, generate_model, nlp_query)', async () => {
  const { handleListModels, handleDescribeModel } = await import('@eloquentjs/mcp/tools')
  const { handleQueryModel } = await import('@eloquentjs/mcp/tools')
  const { handleGenerateModel } = await import('@eloquentjs/mcp/tools')
  const { handleNlpQuery } = await import('@eloquentjs/mcp/tools')

  const mcpCtx = { cwd, config }

  const listed = await handleListModels({}, mcpCtx)
  if (!listed.models?.some(m => m.name === 'User')) {
    throw new Error(`list_models did not find User: ${JSON.stringify(listed)}`)
  }
  if (listed.models.some(m => m.error)) {
    throw new Error(`list_models errored on a file: ${JSON.stringify(listed.models.filter(m => m.error))}`)
  }

  const described = await handleDescribeModel({ model: 'Post' }, mcpCtx)
  if (!described.relations?.some(r => r.name === 'author')) {
    throw new Error(`describe_model Post missing 'author' relation: ${JSON.stringify(described)}`)
  }

  const queried = await handleQueryModel({ model: 'User', where: { is_admin: true }, limit: 5 }, mcpCtx)
  if (!queried.data?.length) throw new Error(`query_model found no admin users: ${JSON.stringify(queried)}`)

  const generated = await handleGenerateModel({
    name: 'Notification',
    fields: { title: 'string', read_at: 'timestamp' },
    relations: [{ name: 'user', type: 'belongsTo', related: 'User' }],
    write: false,
  }, mcpCtx)
  if (!generated.generated?.model?.code?.includes('class Notification')) {
    throw new Error(`generate_model did not return a model stub: ${JSON.stringify(generated)}`)
  }

  const nlp = await handleNlpQuery({ query: 'get the 5 most recent published posts', execute: false }, mcpCtx)
  if (nlp.parsed?.model !== 'Post') throw new Error(`nlp_query did not resolve model to Post: ${JSON.stringify(nlp)}`)
  if (!nlp.generatedCode) throw new Error(`nlp_query returned no code: ${JSON.stringify(nlp)}`)
})

console.log('\n' + '─'.repeat(60))
const failed = results.filter(r => !r.ok)
console.log(`${driver}: ${results.length - failed.length}/${results.length} sections passed`)
if (failed.length) {
  console.log('Failed:', failed.map(f => f.name).join(', '))
  process.exitCode = 1
}

// Open handles (DB pool/handle, Express listener) would otherwise keep the
// process alive — exit explicitly now that every section has reported.
if (apiServer) await new Promise(res => apiServer.close(res))
const { disconnect } = await import(`@eloquentjs/${driver}`)
await disconnect()
process.exit(process.exitCode ?? 0)
