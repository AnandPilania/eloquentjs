# EloquentJS Validation Skill

## When to use this skill
Use when validating any user input — HTTP request bodies, query params, form data, or any untrusted data — in an EloquentJS project.

---

## Installation

```bash
npm install @eloquentjs/validator
```

---

## Decision Guide

| Need | Use |
|---|---|
| Simple sync rules | `Validator.make()` from `@eloquentjs/core` |
| Full rule set + nested fields | `Validator` from `@eloquentjs/validator` |
| Fluent chainable API | `v.schema()` from `@eloquentjs/validator` |
| Unique/exists DB check | `Rule.unique()` / `Rule.exists()` + `parseAsync()` |
| Express middleware | `expressValidate()` from `@eloquentjs/validator/adapters` |
| Fastify hook | `fastifyValidate()` from `@eloquentjs/validator/adapters` |

---

## Fluent Schema (recommended)

```js
import { v, Rule } from '@eloquentjs/validator'

const userSchema = v.schema({
  // Strings
  name:     v.string().min(2).max(100),
  email:    v.string().email(),
  username: v.string().alphaDash().min(3).max(30),
  bio:      v.string().max(500).optional(),
  website:  v.string().url().optional(),
  role:     v.string().oneOf(['admin', 'editor', 'viewer']),
  slug:     v.string().regex(/^[a-z0-9-]+$/),

  // Numbers
  age:      v.number().integer().min(18).max(120),
  price:    v.number().min(0),
  score:    v.number().integer().between(0, 100).optional(),

  // Booleans
  is_active: v.boolean().optional(),

  // Dates
  born_at:   v.date().before('2010-01-01').optional(),
  starts_at: v.date().afterOrEqual(new Date().toISOString().slice(0, 10)),

  // Arrays
  tags:  v.array().min(1).max(10),
  roles: v.array().min(1),

  // Nested objects
  address: v.object({
    city:    v.string(),
    country: v.string().length(2),
    zip:     v.string().digits(5),
  }),

  // Async DB checks (require parseAsync)
  email:   v.string().email().unique('users', 'email'),
  role_id: v.number().integer().exists('roles', 'id'),

  // Confirmation
  password: v.string().min(8).confirmed(),
  // input must also contain password_confirmation
})

// Sync (no async rules)
const data = schema.parse(req.body)
const { success, data, errors } = schema.safeParse(req.body)

// Async (when using .unique(), .exists(), or custom async rules)
const data = await schema.parseAsync(req.body)
const { success, data, errors } = await schema.safeParseAsync(req.body)
```

---

## Express Middleware

```js
import { expressValidate, validationErrorHandler } from '@eloquentjs/validator/adapters'

// Validate body (default)
router.post('/users', expressValidate(userSchema, { async: true }), async (req, res) => {
  const user = await User.create(req.validated)  // only schema-defined fields
  res.status(201).json(user)
})

// Validate query params
router.get('/users', expressValidate(filterSchema, { source: 'query' }), handler)

// Global error handler — mount AFTER all routes
app.use(validationErrorHandler)
// On failure: 422 { message: 'The given data was invalid.', errors: { field: [...] } }
```

---

## Fastify Hook

```js
import { fastifyValidate, fastifyValidationPlugin } from '@eloquentjs/validator/adapters'

// Route hook
fastify.post('/users', {
  preHandler: fastifyValidate(userSchema, { async: true }),
}, async (req, reply) => {
  const user = await User.create(req.validated)
  reply.send(user)
})

// Global error handler
await fastify.register(fastifyValidationPlugin)
```

---

## Unique on Update (ignore current record)

```js
import { Rule } from '@eloquentjs/validator'

// When updating user 42 — allow email if it belongs to user 42 already
const updateSchema = v.schema({
  email: v.string().email().rule(Rule.unique('users', 'email').ignore(42)),
  // or with extra WHERE condition (e.g. multi-tenant):
  email: v.string().email().rule(Rule.unique('users', 'email').ignore(userId).where('tenant_id', tenantId)),
})
```

---

## Custom Async Rule

```js
import { Rule } from '@eloquentjs/validator'

class StrongPassword extends Rule {
  message() { return 'The :field must contain uppercase, lowercase, and a number.' }
  passes(field, value) {
    return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value)
  }
}

class UniquePostSlug extends Rule {
  constructor(excludeId = null) { super(); this.excludeId = excludeId }
  message() { return 'This slug is already taken.' }
  async passesAsync(field, value, data) {
    let qb = Post.where('slug', value)
    if (this.excludeId) qb = qb.where('id', '!=', this.excludeId)
    return !(await qb.exists())
  }
}

// Use in schema
const schema = v.schema({
  password: v.string().min(8).rule(new StrongPassword()),
  slug:     v.string().rule(new UniquePostSlug(existingPostId)),
})
await schema.parseAsync(data)
```

---

## Named Rules (programmatic)

```js
import {
  required, string, email, min, max, integer, boolean,
  oneOf, unique, exists, confirmed, regex, uuid, ip,
  before, after, requiredWith, emailRules, passwordRules
} from '@eloquentjs/validator/rules'

const rules = {
  name:     [required(), string(), min(2), max(100)],
  email:    [required(), ...emailRules(), unique('users', 'email')],
  password: [...passwordRules(10), confirmed()],
  role:     [required(), oneOf('admin', 'editor', 'viewer')],
  user_id:  [required(), integer(), exists('users', 'id')],
}

const data = await Validator.make(req.body, rules).validatedAsync()
```

---

## Error Structure

```js
// ValidationException.errors shape:
{
  name:    ['The name field is required.'],
  email:   ['The email must be a valid email address.', 'The email has already been taken.'],
  'address.zip': ['The address.zip must be 5 digits.'],
}

// Handling in Express
try {
  const data = await schema.parseAsync(req.body)
} catch (err) {
  if (err.name === 'ValidationException') {
    return res.status(422).json({ errors: err.errors })
  }
  throw err
}
```

---

## All Available Rules (quick reference)

### Presence
`required` `nullable` `sometimes` `prohibited` `required_if:f,v` `required_with:a,b` `required_with_all:a,b` `required_without:a,b` `required_without_all:a,b`

### Type
`string` `integer` `numeric` `boolean` `array` `object` `date` `json`

### Size
`min:n` `max:n` `size:n` `between:lo,hi` `digits:n` `digits_between:lo,hi`

### Comparison (cross-field)
`gt:field` `gte:field` `lt:field` `lte:field` `confirmed` `same:field` `different:field`

### String Format
`email` `url` `uuid` `ip` `ipv4` `ipv6` `mac_address` `timezone` `alpha` `alpha_num` `alpha_dash` `regex:pattern` `in:a,b,c` `not_in:a,b` `starts_with:a` `ends_with:a` `doesnt_start_with:a` `doesnt_end_with:a`

### Date
`before:date` `after:date` `before_or_equal:date` `after_or_equal:date`

### Database (async)
`unique:table,column` `exists:table,column`
