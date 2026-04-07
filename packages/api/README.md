# @eloquentjs/api

> One-line REST CRUD routes from your EloquentJS models. Works with Express and Fastify.

```bash
npm install @eloquentjs/core @eloquentjs/api
```

---

## Quick Start

```js
import express from 'express'
import { apiRouter, resource } from '@eloquentjs/api'
import { User, Post } from './models/index.js'

const app = express()
app.use(express.json())

app.use('/api', apiRouter([
  resource(User),
  resource(Post),
]))

app.listen(3000)
```

This generates a full REST API:

```
GET    /api/users              Paginated list
POST   /api/users              Create
GET    /api/users/:id          Single record
PUT    /api/users/:id          Full update
PATCH  /api/users/:id          Partial update
DELETE /api/users/:id          Delete
GET    /api/users/trashed      Soft-deleted records (if softDeletes=true)
POST   /api/users/:id/restore  Restore soft-deleted (if softDeletes=true)
```

---

## Query Parameters

```
GET /api/users?page=2&per_page=20
GET /api/users?search=alice
GET /api/users?sort=name
GET /api/users?sort=-created_at          (prefix - for descending)
GET /api/users?status=active             (auto-filter by any field)
GET /api/users?with=profile,posts        (eager load relations)
```

---

## Resource Options

```js
apiRouter([
  resource(User, {
    // Restrict which routes are generated
    only:   ['index', 'show', 'store'],
    // or exclude specific routes
    except: ['destroy'],

    // Middleware (runs before every route handler)
    middleware: [authRequired, rateLimiter],

    // Always eager-load these relations
    with: ['profile', 'roles'],

    // Columns available for ?search=
    searchable: ['name', 'email', 'bio'],

    // Columns available for ?sort=
    sortable: ['name', 'created_at', 'score'],

    // Custom filter function
    filters: async (qb, query) => {
      if (query.role)    qb.where('role', query.role)
      if (query.country) qb.where('country', query.country)
      if (query.since)   qb.where('created_at', '>=', new Date(query.since))
    },

    // Transform every response
    transform: async (result, req) => {
      // result is a model, array, or paginated object
      return result
    },

    // Authorization policy
    policy: async (req, model, action) => {
      // action: 'index' | 'show' | 'store' | 'update' | 'patch' | 'destroy'
      if (action === 'destroy') return req.user.is_admin
      return true   // allow all others
    },

    // Pagination settings
    paginate: {
      page:           'page',
      perPage:        'per_page',
      defaultPerPage: 15,
      maxPerPage:     100,
    },
  }),
])
```

---

## Nested Resources

```js
apiRouter([
  // POST /api/users/:userId/posts
  // GET  /api/users/:userId/posts
  // GET  /api/users/:userId/posts/:id
  resource(Post, {
    only:   ['index', 'show', 'store'],
    nested: { parent: User, foreignKey: 'user_id' },
  }),
])
```

---

## Error Responses

The router maps known error types to HTTP status codes automatically:

| Error | Status |
|---|---|
| `ModelNotFoundException` | `404 Not Found` |
| `ValidationException` | `422 Unprocessable Entity` |
| `PolicyException` | `403 Forbidden` |
| Any other error | passed to `next(err)` |

---

## Fastify Plugin

```js
import Fastify from 'fastify'
import { fastifyPlugin } from '@eloquentjs/api'

const app = Fastify()

await app.register(fastifyPlugin, {
  models:  [User, Post, Comment],
  prefix:  '/api',
  // Per-model options
  User:    { only: ['index', 'show'] },
  Post:    { with: ['user', 'tags'] },
})

await app.listen({ port: 3000 })
```

---

## Validation Integration

If your model defines a `static rules` object, the `store` and `update` routes validate automatically:

```js
class Post extends Model {
  static rules = {
    title: ['required', 'string', 'min:3', 'max:255'],
    body:  ['required', 'string'],
    status: ['required', 'in:draft,published'],
  }
}

// POST /api/posts with invalid data → 422 { errors: { title: [...] } }
```

---

## Full Example

```js
import express from 'express'
import { apiRouter, resource } from '@eloquentjs/api'
import { User, Post, Comment, Tag } from './models/index.js'

const app = express()
app.use(express.json())

// Auth middleware
const authRequired = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  const user  = token ? await User.where('api_token', token).first() : null
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  req.user = user
  next()
}

app.use('/api', apiRouter([
  resource(User, {
    middleware:  [authRequired],
    with:        ['profile'],
    searchable:  ['name', 'email'],
    sortable:    ['name', 'created_at'],
    policy: async (req, model, action) => {
      if (action === 'destroy') return req.user.is_admin || req.user.id === model?.id
      return true
    },
  }),

  resource(Post, {
    with:       ['user', 'tags'],
    searchable: ['title', 'body'],
    sortable:   ['created_at', 'view_count'],
    filters: async (qb, query) => {
      if (query.status) qb.where('status', query.status)
      if (query.tag)    qb.join('post_tags', ...).join('tags', ...).where('tags.slug', query.tag)
    },
  }),

  resource(Comment, {
    only:       ['index', 'show', 'store', 'destroy'],
    nested:     { parent: Post, foreignKey: 'post_id' },
    middleware: [authRequired],
  }),

  resource(Tag, { only: ['index', 'show'] }),
]))

app.listen(3000)
```

---

## License

MIT
