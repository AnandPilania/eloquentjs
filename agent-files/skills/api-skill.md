# EloquentJS API Skill

## When to use this skill
Use when building REST API endpoints with `@eloquentjs/api` for Express or Fastify.

---

## One-line CRUD

```js
import express from 'express'
import { apiRouter, resource } from '@eloquentjs/api'
import User from './models/User.js'
import Post from './models/Post.js'

const app = express()
app.use(express.json())

app.use('/api', apiRouter([
  resource(User),
  resource(Post),
]))
```

This generates for `User`:
```
GET    /api/users              — list (paginated, filterable, sortable)
POST   /api/users              — create
GET    /api/users/:id          — show
PUT    /api/users/:id          — full update
PATCH  /api/users/:id          — partial update
DELETE /api/users/:id          — delete
GET    /api/users/trashed      — (if softDeletes) soft-deleted list
POST   /api/users/:id/restore  — (if softDeletes) restore
```

---

## Resource Options

```js
resource(User, {
  // Restrict routes
  only:   ['index', 'show', 'store'],   // only these routes
  except: ['destroy'],                   // all except these

  // Middleware applied to every route
  middleware: [authRequired, rateLimiter],

  // Always eager-load these relations
  with: ['profile', 'roles'],

  // Fields usable in ?search=
  searchable: ['name', 'email', 'bio'],

  // Fields usable in ?sort= (prefix - for desc)
  sortable: ['name', 'created_at', 'score'],

  // Custom filter function
  filters: async (qb, query) => {
    if (query.role)    qb.where('role', query.role)
    if (query.country) qb.where('country', query.country)
    if (query.since)   qb.where('created_at', '>=', new Date(query.since))
  },

  // Transform response before sending
  transform: async (result, req) => result,

  // Authorization policy
  policy: async (req, model, action) => {
    // action: 'index'|'show'|'store'|'update'|'patch'|'destroy'
    if (action === 'destroy') return req.user.is_admin || req.user.id === model?.id
    return true
  },

  // Pagination settings
  paginate: { page: 'page', perPage: 'per_page', defaultPerPage: 15, maxPerPage: 100 },
})
```

---

## Query Parameters (auto-handled)

```
GET /api/users?page=2&per_page=20          — pagination
GET /api/users?search=alice                 — searches searchable fields
GET /api/users?sort=name                    — sort ascending
GET /api/users?sort=-created_at             — sort descending (- prefix)
GET /api/users?with=profile,posts           — eager load relations
GET /api/users?role=admin                   — auto-filter any field
```

---

## Nested Resources

```js
// GET    /api/posts/:postId/comments
// POST   /api/posts/:postId/comments
// GET    /api/posts/:postId/comments/:id
resource(Comment, {
  only:   ['index', 'show', 'store', 'destroy'],
  nested: { parent: Post, foreignKey: 'post_id' },
  middleware: [authRequired],
})
```

---

## Validation Integration

Add `static rules` to your model — `store` and `update` routes validate automatically:

```js
class Post extends Model {
  static rules = {
    title:  ['required', 'string', 'min:3', 'max:255'],
    body:   ['required', 'string'],
    status: ['required', 'in:draft,published,archived'],
  }
}
// POST /api/posts with invalid data → 422 { errors: { title: [...] } }
```

---

## Fastify Plugin

```js
import Fastify from 'fastify'
import { fastifyPlugin } from '@eloquentjs/api'

const app = Fastify()
await app.register(fastifyPlugin, {
  models:  [User, Post, Comment],
  prefix:  '/api',
  User:    { only: ['index', 'show'] },
  Post:    { with: ['user', 'tags'] },
})
```

---

## Error Responses

The router maps errors automatically:

| Error | HTTP Status |
|---|---|
| `ModelNotFoundException` | 404 Not Found |
| `ValidationException` | 422 Unprocessable Entity |
| `PolicyException` | 403 Forbidden |
| Other errors | passed to `next(err)` |

---

## Custom Endpoints

Combine `apiRouter` with custom routes:

```js
app.use('/api', apiRouter([resource(User), resource(Post)]))

// Custom endpoints sit alongside
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body
  const user = await User.where('email', email).first()
  if (!user || !await user.checkPassword(password)) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }
  res.json({ token: generateToken(), user: user.toJSON() })
})

app.post('/api/posts/:id/publish', authRequired, async (req, res) => {
  const post = await Post.findOrFail(req.params.id)
  await post.update({ status: 'published' })
  res.json(post.toJSON())
})
```
