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
 * Fastify usage — same actions and same options, per model by class name:
 *   import { fastifyPlugin } from '@eloquentjs/api'
 *   await app.register(fastifyPlugin, {
 *     models: [User, Post],
 *     User: { policy, sortable: ['created_at'] },
 *   })
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

import {
  ModelNotFoundException,
  ValidationException,
  PolicyException,
  toSnakePlural,
  toSnakeCase,
} from '@eloquentjs/core'

export function resource(ModelClass, options = {}) {
  return { ModelClass, options }
}

export function apiRouter(resources, globalOptions = {}) {
  // One flat route table across every resource, matched segment by segment.
  // A `req.path.startsWith(prefix)` scan (the previous approach) made nested
  // resources unreachable: a nested resource's prefix is its *parent's* path,
  // so `GET /posts/1/comments` was answered by Post's `show`.
  const routes = resources
    .flatMap(({ ModelClass, options }) => buildRoutes(ModelClass, { ...globalOptions, ...options }))
    .sort(routeSpecificity)

  return (req, res, next) => {
    const segments = splitPath(req.path)
    const method = req.method.toLowerCase()

    for (const route of routes) {
      if (route.method !== method) continue
      const params = matchRoute(route.pattern, segments)
      if (params) return route.handle(req, res, next, params)
    }
    next()
  }
}

/** Literal segments beat params; longer patterns beat shorter ones. */
function routeSpecificity(a, b) {
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length
  const literals = p => p.filter(s => !s.startsWith(':')).length
  return literals(b.pattern) - literals(a.pattern)
}

function splitPath(path) {
  return String(path ?? '').split('/').filter(Boolean)
}

/** @returns {Record<string, string>|null} the captured params, or null */
function matchRoute(pattern, segments) {
  if (pattern.length !== segments.length) return null
  const params = {}
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(segments[i])
    else if (pattern[i] !== segments[i]) return null
  }
  return params
}

function buildRoutes(ModelClass, options = {}) {
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
    filterable = [],           // columns exposed to ?column=value (opt-in)
    searchable = [],           // auto-adds ?search= support
    sortable = [],             // allowed sort columns (opt-in, like filterable)
    softDeletes = ModelClass.softDeletes,
  } = options

  const allowed = new Set(only.filter(a => !except.includes(a)))
  const base = nested
    ? [routePath(nested.parent.name), ':parentId', routePath(ModelClass.name)]
    : [routePath(ModelClass.name)]

  const foreignKey = nested?.foreignKey ?? `${toSnakeCase(nested?.parent?.name ?? '')}_id`
  const ctx = {
    withs, paginate, filters, filterable, searchable, sortable,
    nested: nested ? { ...nested, foreignKey } : null,
    policy, softDeletes,
  }

  /** @param {string} action @param {string} method @param {string[]} extra */
  const route = (action, method, extra, run) => ({
    action,
    method,
    pattern: [...base, ...extra],
    handle: makeHandler({ action, middleware, transform, run }),
  })

  const routes = []
  if (allowed.has('index')) routes.push(route('index', 'get', [], (req, p) => handleIndex(ModelClass, req, ctx, p)))
  if (allowed.has('store')) routes.push(route('store', 'post', [], (req, p) => handleStore(ModelClass, req, ctx, p)))
  if (softDeletes) {
    routes.push(route('trashed', 'get', ['trashed'], req => handleTrashed(ModelClass, req, ctx)))
    routes.push(route('restore', 'post', [':id', 'restore'], (req, p) => handleRestore(ModelClass, p.id, req, ctx)))
  }
  if (allowed.has('show')) routes.push(route('show', 'get', [':id'], (req, p) => handleShow(ModelClass, p.id, req, ctx)))
  if (allowed.has('update')) routes.push(route('update', 'put', [':id'], (req, p) => handleUpdate(ModelClass, p.id, req, ctx)))
  if (allowed.has('patch')) routes.push(route('patch', 'patch', [':id'], (req, p) => handleUpdate(ModelClass, p.id, req, ctx)))
  if (allowed.has('destroy')) routes.push(route('destroy', 'delete', [':id'], (req, p) => handleDestroy(ModelClass, p.id, req, ctx)))

  return routes
}

function makeHandler({ action, middleware, transform, run }) {
  return async (req, res, next, params) => {
    try {
      for (const mw of middleware) {
        if (!(await runMiddleware(mw, req, res))) return   // middleware answered
      }

      let result = await run(req, params)
      if (transform) result = await transform(result, req)

      if (result === null) return res.status(404).json({ error: 'Not found' })
      if (result === true) return res.status(204).end()
      res.status(action === 'store' ? 201 : 200).json(serialize(result))
    } catch (err) {
      if (err.name === 'ModelNotFoundException') return res.status(404).json({ error: err.message })
      if (err.name === 'ValidationException') return res.status(422).json({ errors: err.errors })
      if (err.name === 'PolicyException') return res.status(403).json({ error: err.message })
      if (err.name === 'MassAssignmentException') return res.status(422).json({ error: err.message })
      next(err)
    }
  }
}

/**
 * Run one Express middleware.
 * @returns {Promise<boolean>} true to continue, false when the middleware
 * answered the request itself. Waiting only on next() — the old behaviour —
 * hung forever on the normal `res.status(401).json(...); return` pattern.
 */
function runMiddleware(mw, req, res) {
  return /** @type {Promise<boolean>} */ (new Promise((resolve, reject) => {
    let settled = false
    const done = value => { if (!settled) { settled = true; resolve(value) } }

    res.once?.('finish', () => done(false))
    res.once?.('close', () => done(false))

    const maybe = mw(req, res, err => (err ? reject(err) : done(true)))

    // Also handle a middleware that responds synchronously without any events
    // (a mock res, or one that only sets headersSent).
    Promise.resolve(maybe).then(() => {
      if (res.headersSent || res.writableEnded) done(false)
    }, reject)
  }))
}

// ─── Route Handlers ───────────────────────────────────────────────────────────

/**
 * Clamp a pagination parameter. `parseInt(undefined)` is NaN, and
 * `Math.min(NaN, 100)` is NaN — which reached the driver as the LIMIT.
 * `?page=0` produced a negative OFFSET.
 */
function clampInt(value, fallback, { min = 1, max = Infinity } = {}) {
  const n = parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

function pageParams(query, paginate) {
  return {
    page: clampInt(query?.[paginate.page], 1),
    perPage: clampInt(query?.[paginate.perPage], paginate.defaultPerPage ?? 15, {
      max: paginate.maxPerPage ?? 100,
    }),
  }
}

async function handleIndex(ModelClass, req, { withs, paginate, filters, filterable, searchable, sortable, nested, policy }, params = {}) {
  const query = req.query ?? {}
  const { page, perPage } = pageParams(query, paginate)

  if (policy) {
    if (!(await policy(req, null, 'index'))) throw new PolicyException('Forbidden')
  }

  let qb = ModelClass.query()

  // Nested resource scope
  if (nested && params.parentId !== undefined) {
    qb = qb.where(nested.foreignKey, params.parentId)
  }

  // Search
  if (searchable.length && query.search) {
    qb = qb.where(qb2 => {
      for (const col of searchable) {
        qb2.orWhere(col, 'LIKE', `%${query.search}%`)
      }
    })
  }

  // Filters — ?field=value only for columns explicitly listed in `filterable`.
  // Opt-in on purpose: filtering on any param let clients probe hidden columns
  // (?password_reset_token=…) and use the row count as an oracle.
  if (filters) {
    await filters(qb, query)
  } else if (filterable.length) {
    const hidden = new Set(ModelClass.hidden ?? [])
    for (const key of filterable) {
      const value = query[key]
      if (value === undefined || value === '' || hidden.has(key)) continue
      qb = qb.where(key, value)
    }
  }

  // Sort — opt-in, exactly like `filterable`. An empty `sortable` used to allow
  // ordering by ANY column, including hidden ones, which leaks their ordering.
  if (query.sort && sortable.length) {
    const col = String(query.sort).replace(/^-/, '')
    const dir = String(query.sort).startsWith('-') ? 'desc' : (query.order === 'desc' ? 'desc' : 'asc')
    if (sortable.includes(col)) qb = qb.orderBy(col, dir)
  }

  // Eager loads
  qb = applyWiths(qb, withs, query, ModelClass)

  return qb.paginate(page, perPage)
}

/**
 * `?with=` may only name relations the resource opted into — otherwise a client
 * can traverse to any related model, policies and all.
 */
function applyWiths(qb, withs, query, ModelClass) {
  const requested = query?.with ? String(query.with).split(',').map(s => s.trim()) : []
  const permitted = new Set(withs)
  const all = [...new Set([...withs, ...requested.filter(r => permitted.has(r.split('.')[0]))])]
  return all.length ? qb.with(...all) : qb
}

async function handleStore(ModelClass, req, { nested, policy }, params = {}) {
  const data = { ...req.body }
  if (nested && params.parentId !== undefined) data[nested.foreignKey] = params.parentId

  if (policy) {
    const allowed = await policy(req, null, 'store')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  await validateOrThrow(ModelClass, data)

  return ModelClass.create(data)
}

/**
 * Validate against `static rules`. Uses validateAsync so that `unique`/`exists`
 * actually run — the sync path skips them by design.
 */
async function validateOrThrow(ModelClass, data) {
  if (!ModelClass.rules) return
  const { Validator } = await import('@eloquentjs/core')
  const v = Validator.make(data, ModelClass.rules, ModelClass.validationMessages ?? {})
  if (await v.failsAsync()) throw new ValidationException(v.errors)
}

async function handleShow(ModelClass, id, req, { withs, policy }) {
  let qb = ModelClass.where(ModelClass.getRouteKeyName(), id)
  qb = applyWiths(qb, withs, req.query, ModelClass)

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

  await validateOrThrow(ModelClass, req.body)

  await model.update(req.body)
  return model
}

async function handleDestroy(ModelClass, id, req, { policy }) {
  const model = await ModelClass.findOrFail(id)

  if (policy) {
    const allowed = await policy(req, model, 'destroy')
    if (!allowed) throw new PolicyException('Forbidden')
  }

  await model.delete()
  return true
}

/** Soft-deleted records are still records: same policy, same pagination caps. */
async function handleTrashed(ModelClass, req, { paginate, policy }) {
  if (policy) {
    if (!(await policy(req, null, 'trashed'))) throw new PolicyException('Forbidden')
  }
  const { page, perPage } = pageParams(req.query ?? {}, paginate)
  return ModelClass.onlyTrashed().paginate(page, perPage)
}

async function handleRestore(ModelClass, id, req, { policy }) {
  const model = await ModelClass.withTrashed().where(ModelClass.primaryKey, id).first()
  if (!model) throw new ModelNotFoundException(`${ModelClass.name} not found in trash`)

  if (policy) {
    if (!(await policy(req, model, 'restore'))) throw new PolicyException('Forbidden')
  }

  await model.restore()
  return model
}

// ─── Fastify Plugin ───────────────────────────────────────────────────────────
/**
 * Registers the same actions as apiRouter, with the same policy, filtering,
 * search, sort, eager-load, soft-delete and nested-resource support.
 *
 *   await app.register(fastifyPlugin, {
 *     models: [User, Post],
 *     User: { policy, filterable: ['role'], sortable: ['created_at'] },
 *   })
 *
 * Note: no content-type parser is registered — Fastify ships an
 * `application/json` parser by default and re-registering it throws
 * FST_ERR_CTP_ALREADY_PRESENT.
 */
export async function fastifyPlugin(fastify, options = {}) {
  const { models = [], prefix = '/api', ...globalOptions } = options
  const perModel = Object.fromEntries(models.map(m => [m.name, globalOptions[m.name] ?? {}]))
  const shared = Object.fromEntries(Object.entries(globalOptions).filter(([k]) => !(k in perModel)))

  for (const ModelClass of models) {
    registerFastifyRoutes(fastify, ModelClass, { prefix, ...shared, ...perModel[ModelClass.name] })
  }
}

function registerFastifyRoutes(fastify, ModelClass, options = {}) {
  const { prefix = '/api' } = options
  // Reuse the Express route table, adapting the request/reply shapes.
  const routes = buildRoutes(ModelClass, options)

  for (const route of routes) {
    const path = `${prefix}/${route.pattern.join('/')}`
    fastify[route.method](path, async (req, reply) => {
      const shim = {
        status: code => { reply.code(code); return shim },
        json: payload => payload,
        end: () => { reply.code(204); return null },
        headersSent: false,
        writableEnded: false,
        once: () => { },
      }
      return route.handle(
        { ...req, path: req.url.split('?')[0], method: req.method, query: req.query, body: req.body },
        shim,
        err => { throw err },
        req.params,
      )
    })
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function serialize(data) {
  if (!data) return data
  if (data.data && data.meta) return { data: data.data.map(m => m?.toJSON?.() ?? m), meta: data.meta }
  if (Array.isArray(data)) return data.map(m => m?.toJSON?.() ?? m)
  return data?.toJSON?.() ?? data
}

/**
 * Model class name → URL path segment. Pluralization comes from core so
 * routes, table names and generated migrations agree (Category → categories).
 */
function routePath(name) {
  return toSnakePlural(name).replace(/_/g, '-')
}
