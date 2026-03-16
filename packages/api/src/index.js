/**
 * @eloquentjs/api
 *
 * One-line REST CRUD routes from your EloquentJS models.
 * Works with Express and Fastify.
 *
 * Express usage:
 *   import { resource, apiRouter } from '@eloquentjs/api'
 *   import express from 'express'
 *
 *   const app = express()
 *   app.use('/api', apiRouter([
 *     resource(User),
 *     resource(Post, { middleware: [authRequired] }),
 *     resource(Comment, {
 *       only: ['index', 'show', 'store'],
 *       nested: { parent: Post, foreignKey: 'post_id' },
 *     }),
 *   ]))
 *
 * Fastify usage:
 *   import { fastifyPlugin } from '@eloquentjs/api'
 *   await app.register(fastifyPlugin, { models: [User, Post] })
 *
 * Generated routes:
 *   GET    /users              → index    (paginated list, filterable)
 *   POST   /users              → store    (create)
 *   GET    /users/:id          → show     (single record + eager loads)
 *   PUT    /users/:id          → update   (full update)
 *   PATCH  /users/:id          → patch    (partial update)
 *   DELETE /users/:id          → destroy  (delete)
 *   GET    /users/trashed      → trashed  (soft-delete trash, if enabled)
 *   POST   /users/:id/restore  → restore  (restore soft-deleted)
 *
 * Nested resource (POST /posts/:postId/comments):
 *   GET    /posts/:postId/comments
 *   POST   /posts/:postId/comments
 *   GET    /posts/:postId/comments/:id
 *   etc.
 */

export function resource(ModelClass, options = {}) {
  return { ModelClass, options }
}

export function apiRouter(resources, globalOptions = {}) {
  // Returns a function that works as Express middleware
  const handlers = resources.map(({ ModelClass, options }) =>
    buildExpressRouter(ModelClass, { ...globalOptions, ...options })
  )

  return (req, res, next) => {
    // Find matching handler
    for (const { prefix, handle } of handlers) {
      if (req.path.startsWith(prefix)) {
        return handle(req, res, next)
      }
    }
    next()
  }
}

function buildExpressRouter(ModelClass, options = {}) {
  const {
    only = ['index', 'show', 'store', 'update', 'patch', 'destroy'],
    except = [],
    middleware = [],
    nested = null,
    with: withs = [],          // always eager-load these relations
    paginate = { page: 'page', perPage: 'per_page', defaultPerPage: 15, maxPerPage: 100 },
    transform = null,          // transform response: (model, action) => {}
    policy = null,             // policy: async (req, model, action) => bool
    filters = null,            // custom filter fn: (qb, query) => void
    searchable = [],           // auto-adds ?search= support
    sortable = [],             // allowed sort columns
    softDeletes = ModelClass.softDeletes,
  } = options

  const allowed = new Set(only.filter(a => !except.includes(a)))

  const basePath = toKebab(ModelClass.name) + 's'
  const prefix = nested
    ? `/${toKebab(nested.parent.name)}s`
    : `/${basePath}`

  const handle = async (req, res, next) => {
    try {
      // Run middleware
      for (const mw of middleware) {
        await new Promise((resolve, reject) => mw(req, res, (err) => err ? reject(err) : resolve()))
      }

      const path = req.path
      const method = req.method.toLowerCase()
      const params = extractParams(path, prefix, basePath, nested)
      if (!params) return next()

      const { id, parentId } = params
      let result

      // ROUTE MATCHING
      if (!id && method === 'get' && allowed.has('index')) {
        result = await handleIndex(ModelClass, req, { withs, paginate, filters, searchable, sortable, nested, parentId })
      } else if (!id && method === 'post' && allowed.has('store')) {
        result = await handleStore(ModelClass, req, { nested, parentId, policy })
      } else if (id === 'trashed' && method === 'get' && softDeletes) {
        result = await handleTrashed(ModelClass, req, { paginate })
      } else if (id && !req.path.endsWith('/restore') && method === 'get' && allowed.has('show')) {
        result = await handleShow(ModelClass, id, req, { withs, policy })
      } else if (id && method === 'put' && allowed.has('update')) {
        result = await handleUpdate(ModelClass, id, req, { policy })
      } else if (id && method === 'patch' && allowed.has('patch')) {
        result = await handleUpdate(ModelClass, id, req, { policy })
      } else if (id && method === 'delete' && allowed.has('destroy')) {
        result = await handleDestroy(ModelClass, id, req, { policy, softDeletes })
      } else if (id && req.path.endsWith('/restore') && method === 'post' && softDeletes) {
        result = await handleRestore(ModelClass, id)
      } else {
        return next()
      }

      if (transform) result = await transform(result, req)

      const statusCode = method === 'post' ? 201 : 200
      if (result === null) return res.status(404).json({ error: 'Not found' })
      if (result === true) return res.status(204).end()
      res.status(statusCode).json(serialize(result))
    } catch (err) {
      if (err.name === 'ModelNotFoundException') return res.status(404).json({ error: err.message })
      if (err.name === 'ValidationException') return res.status(422).json({ errors: err.errors })
      if (err.name === 'PolicyException') return res.status(403).json({ error: err.message })
      next(err)
    }
  }

  return { prefix, handle }
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

async function handleIndex(ModelClass, req, { withs, paginate, filters, searchable, sortable, nested, parentId }) {
  const query = req.query
  const page = parseInt(query[paginate.page] ?? 1)
  const perPage = Math.min(parseInt(query[paginate.perPage] ?? paginate.defaultPerPage), paginate.maxPerPage ?? 100)

  let qb = ModelClass.query()

  // Nested resource scope
  if (nested && parentId) {
    qb = qb.where(nested.foreignKey, parentId)
  }

  // Search
  if (searchable.length && query.search) {
    qb = qb.where(qb2 => {
      for (const col of searchable) {
        qb2.orWhere(col, 'LIKE', `%${query.search}%`)
      }
    })
  }

  // Filters (auto-apply ?field=value for whitelisted fields)
  if (filters) {
    await filters(qb, query)
  } else {
    // Auto-filter: ?field=value for any query param
    const reservedParams = new Set(['page', paginate.page, paginate.perPage, 'search', 'sort', 'order', 'with'])
    for (const [key, value] of Object.entries(query)) {
      if (!reservedParams.has(key) && value !== '') {
        qb = qb.where(key, value)
      }
    }
  }

  // Sort
  if (query.sort) {
    const col = query.sort.replace(/^-/, '')
    const dir = query.sort.startsWith('-') ? 'desc' : (query.order ?? 'asc')
    if (!sortable.length || sortable.includes(col)) {
      qb = qb.orderBy(col, dir)
    }
  }

  // Eager loads
  const requestedWith = query.with ? query.with.split(',') : []
  const allWiths = [...new Set([...withs, ...requestedWith])]
  if (allWiths.length) qb = qb.with(...allWiths)

  return qb.paginate(page, perPage)
}

async function handleStore(ModelClass, req, { nested, parentId, policy }) {
  const data = { ...req.body }
  if (nested && parentId) data[nested.foreignKey] = parentId

  if (policy) {
    const allowed = await policy(req, null, 'store')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  // Validate if model has rules
  if (ModelClass.rules) {
    const { Validator } = await import('@eloquentjs/core')
    const v = Validator.make(data, ModelClass.rules)
    if (v.fails()) throw new ValidationException(v.errors)
  }

  return ModelClass.create(data)
}

async function handleShow(ModelClass, id, req, { withs, policy }) {
  let qb = ModelClass.where(ModelClass.primaryKey, id)
  const requestedWith = req.query.with ? req.query.with.split(',') : []
  const allWiths = [...new Set([...withs, ...requestedWith])]
  if (allWiths.length) qb = qb.with(...allWiths)

  const model = await qb.first()
  if (!model) throw new ModelNotFoundException(`${ModelClass.name} not found`)

  if (policy) {
    const allowed = await policy(req, model, 'show')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  return model
}

async function handleUpdate(ModelClass, id, req, { policy }) {
  const model = await ModelClass.findOrFail(id)

  if (policy) {
    const allowed = await policy(req, model, 'update')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  if (ModelClass.rules) {
    const { Validator } = await import('@eloquentjs/core')
    const v = Validator.make(req.body, ModelClass.rules)
    if (v.fails()) throw new ValidationException(v.errors)
  }

  await model.update(req.body)
  return model
}

async function handleDestroy(ModelClass, id, req, { policy, softDeletes }) {
  const model = await ModelClass.findOrFail(id)

  if (policy) {
    const allowed = await policy(req, model, 'destroy')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  await model.delete()
  return true
}

async function handleTrashed(ModelClass, req, { paginate }) {
  const page = parseInt(req.query.page ?? 1)
  const perPage = parseInt(req.query.per_page ?? 15)
  return ModelClass.onlyTrashed().paginate(page, perPage)
}

async function handleRestore(ModelClass, id) {
  const model = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).first()
  if (!model) throw new ModelNotFoundException(`${ModelClass.name} not found in trash`)
  await model.restore()
  return model
}

// ─── Fastify Plugin ───────────────────────────────────────────────────────────
export async function fastifyPlugin(fastify, options = {}) {
  const { models = [], prefix = '/api', ...globalOptions } = options

  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try { done(null, JSON.parse(body)) } catch (e) { done(e) }
  })

  for (const ModelClass of models) {
    const opts = globalOptions[ModelClass.name] ?? {}
    registerFastifyRoutes(fastify, ModelClass, { prefix, ...opts })
  }
}

function registerFastifyRoutes(fastify, ModelClass, options = {}) {
  const { prefix = '/api', only = ['index','show','store','update','destroy'], except = [], withs = [] } = options
  const base = `${prefix}/${toKebab(ModelClass.name)}s`

  const allowed = new Set(only.filter(a => !except.includes(a)))

  if (allowed.has('index')) {
    fastify.get(base, async (req, reply) => {
      const { page = 1, per_page = 15 } = req.query
      const qb = ModelClass.query()
      if (withs.length) qb.with(...withs)
      return qb.paginate(Number(page), Number(per_page))
    })
  }
  if (allowed.has('show')) {
    fastify.get(`${base}/:id`, async (req, reply) => {
      return ModelClass.findOrFail(req.params.id)
    })
  }
  if (allowed.has('store')) {
    fastify.post(base, { schema: { response: { 201: {} } } }, async (req, reply) => {
      reply.code(201)
      return ModelClass.create(req.body)
    })
  }
  if (allowed.has('update')) {
    fastify.put(`${base}/:id`, async (req) => {
      const model = await ModelClass.findOrFail(req.params.id)
      await model.update(req.body)
      return model
    })
    fastify.patch(`${base}/:id`, async (req) => {
      const model = await ModelClass.findOrFail(req.params.id)
      await model.update(req.body)
      return model
    })
  }
  if (allowed.has('destroy')) {
    fastify.delete(`${base}/:id`, async (req, reply) => {
      const model = await ModelClass.findOrFail(req.params.id)
      await model.delete()
      reply.code(204)
    })
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function extractParams(path, prefix, basePath, nested) {
  const segments = path.split('/').filter(Boolean)
  if (!segments.length) return null

  if (nested) {
    // /posts/:postId/comments/:id
    const parentSegment = toKebab(nested.parent.name) + 's'
    const idx = segments.indexOf(parentSegment)
    if (idx === -1) return null
    return { parentId: segments[idx + 1], id: segments[idx + 3] }
  }

  const baseSegment = basePath.replace(/^\//, '')
  const idx = segments.indexOf(baseSegment)
  if (idx === -1) return null
  return { id: segments[idx + 1] }
}

function serialize(data) {
  if (!data) return data
  if (data.data && data.meta) return { data: data.data.map(m => m?.toJSON?.() ?? m), meta: data.meta }
  if (Array.isArray(data)) return data.map(m => m?.toJSON?.() ?? m)
  return data?.toJSON?.() ?? data
}

function toKebab(name) {
  return name.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')
}

class ModelNotFoundException extends Error {
  constructor(msg) { super(msg); this.name = 'ModelNotFoundException' }
}

class PolicyException extends Error {
  constructor(msg) { super(msg); this.name = 'PolicyException' }
}

class ValidationException extends Error {
  constructor(errors) { super('Validation failed'); this.name = 'ValidationException'; this.errors = errors }
}
