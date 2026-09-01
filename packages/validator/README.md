# @eloquentjs/validator

> Full-featured standalone validation for EloquentJS and any Node.js app — sync and async rules, fluent schema API, DB-backed `unique`/`exists` checks, custom Rule objects, and Express/Fastify adapters.

```bash
npm install @eloquentjs/validator
```

---

## Three Ways to Validate

### 1. Fluent Schema API (recommended)

```js
import { v } from '@eloquentjs/validator'

const schema = v.schema({
  name:     v.string().min(2).max(100),
  email:    v.string().email(),
  password: v.string().min(8).confirmed(),
  age:      v.number().integer().min(18).optional(),
  role:     v.string().oneOf(['admin', 'editor', 'viewer']),
  address:  v.object({
    city:    v.string(),
    country: v.string().length(2),
  }),
  tags: v.array().min(1).max(10),
})

// parse() — throws ValidationException on failure
const data = schema.parse(req.body)

// safeParse() — never throws, returns { success, data, errors }
const { success, data, errors } = schema.safeParse(req.body)

// Async (required when using .unique(), .exists(), or async custom rules)
const data = await schema.parseAsync(req.body)
const { success, data, errors } = await schema.safeParseAsync(req.body)
```

### 2. Laravel-style rule arrays

```js
import { Validator } from '@eloquentjs/validator'

const validator = Validator.make(req.body, {
  name:  ['required', 'string', 'min:2', 'max:100'],
  email: ['required', 'email'],
  age:   ['required', 'integer', 'min:18'],
  role:  ['required', 'in:admin,editor,viewer'],
})

if (validator.fails()) {
  return res.status(422).json({ errors: validator.errors })
}
const data = validator.validated()  // only the declared fields

// Async (for unique/exists rules)
if (await validator.failsAsync()) {
  return res.status(422).json({ errors: validator.errors })
}
```

### 3. Named rule functions

```js
import { required, string, email, min, max, unique, inList } from '@eloquentjs/validator/rules'

const rules = {
  name:  [required(), string(), min(2), max(100)],
  email: [required(), email(), max(255), unique('users', 'email')],
  role:  [required(), inList('admin', 'editor', 'viewer')],
}

const data = await Validator.make(req.body, rules).validatedAsync()
```

---

## All Validation Rules

### Presence
| Rule | Description |
|---|---|
| `required` | Value must be present and non-empty |
| `nullable` | Allows null/undefined (stops further checks if empty) |
| `sometimes` | Only validate when field is present in input |
| `prohibited` | Field must not be present |
| `required_if:field,value` | Required when another field equals a value |
| `required_with:a,b` | Required when any of the listed fields are present |
| `required_with_all:a,b` | Required when all listed fields are present |
| `required_without:a,b` | Required when any of the listed fields are absent |
| `required_without_all:a,b` | Required when all listed fields are absent |

### Type
| Rule | Description |
|---|---|
| `string` | Must be a string |
| `integer` / `int` | Must be an integer |
| `numeric` | Must be a number |
| `boolean` / `bool` | Must be a boolean (true/false/0/1) |
| `array` | Must be an array |
| `object` | Must be a plain object |
| `date` | Must be a parseable date |
| `json` | Must be a valid JSON string |

### Size / Length
| Rule | Description |
|---|---|
| `min:n` | Min length (string/array) or min value (number) |
| `max:n` | Max length or max value |
| `size:n` | Exact length or value |
| `between:lo,hi` | Value between lo and hi |
| `digits:n` | Exactly n digits |
| `digits_between:lo,hi` | Between lo and hi digits |
| `gt:field` | Greater than another field's value |
| `gte:field` | Greater than or equal to |
| `lt:field` | Less than |
| `lte:field` | Less than or equal to |

### String Format
| Rule | Description |
|---|---|
| `email` | Valid email address |
| `url` | Valid URL |
| `uuid` | Valid UUID v1-v5 |
| `ip` / `ipv4` / `ipv6` | Valid IP address |
| `mac_address` | Valid MAC address |
| `timezone` | Valid IANA timezone |
| `alpha` | Letters only |
| `alpha_num` | Letters and numbers only |
| `alpha_dash` | Letters, numbers, dashes, underscores |
| `starts_with:a,b` | Must start with one of the values |
| `ends_with:a,b` | Must end with one of the values |
| `doesnt_start_with:a` | Must not start with value |
| `doesnt_end_with:a` | Must not end with value |
| `regex:pattern` | Must match regex pattern |
| `in:a,b,c` | Must be one of the listed values |
| `not_in:a,b,c` | Must not be one of the listed values |
| `confirmed` | Must match `field_confirmation` |
| `same:field` | Must match another field |
| `different:field` | Must differ from another field |

### Date
| Rule | Description |
|---|---|
| `before:date` | Must be before the given date |
| `after:date` | Must be after the given date |
| `before_or_equal:date` | Must be before or equal to date |
| `after_or_equal:date` | Must be after or equal to date |

### Database (async)
| Rule | Description |
|---|---|
| `unique:table,column` | No matching record in DB |
| `exists:table,column` | Matching record must exist in DB |

---

## DB-Backed Rules

Use `Rule.unique()` and `Rule.exists()` for database validation. These require `validateAsync()` or `parseAsync()`.

```js
import { Rule } from '@eloquentjs/validator'

const rules = {
  // Email must not already exist in users table
  email: ['required', 'email', Rule.unique('users', 'email')],

  // When updating — ignore the current user's own record
  email: ['required', 'email', Rule.unique('users', 'email').ignore(userId)],

  // Extra WHERE conditions
  email: ['required', 'email', Rule.unique('users', 'email')
    .ignore(userId)
    .where('tenant_id', tenantId)],

  // Foreign key must exist
  role_id: ['required', Rule.exists('roles', 'id')],
}

// Must use async path for DB rules
const data = await Validator.make(req.body, rules).validatedAsync()
```

---

## Custom Rule Objects

Extend `Rule` to create reusable, testable rule classes:

```js
import { Rule } from '@eloquentjs/validator'

// Sync rule
class SlugFormat extends Rule {
  message() { return 'The :field must be a valid slug (lowercase letters, numbers, hyphens).' }
  passes(field, value) {
    return /^[a-z0-9-]+$/.test(value)
  }
}

// Async rule (DB lookup, API call, etc.)
class UniqueSlug extends Rule {
  constructor(postId = null) { super(); this.postId = postId }
  message() { return 'This slug is already in use.' }
  async passesAsync(field, value, data) {
    let qb = Post.where('slug', value)
    if (this.postId) qb = qb.where('id', '!=', this.postId)
    return !(await qb.exists())
  }
}

// Implicit rule (runs even when value is empty)
class RequiredForPremium extends Rule {
  static implicit = true
  message() { return ':field is required for premium accounts.' }
  passes(field, value, data) {
    if (data.plan !== 'premium') return true
    return value != null && value !== ''
  }
}

// Use in rules
const validator = Validator.make(data, {
  slug: ['required', new SlugFormat(), new UniqueSlug(existingPostId)],
})
await validator.validatedAsync()
```

---

## Nested Fields & Objects

```js
// Dot-notation for nested objects
const validator = Validator.make(data, {
  'address.city':    ['required', 'string'],
  'address.zip':     ['required', 'digits:5'],
  'address.country': ['required', 'size:2'],
})

// Schema API handles nesting automatically
const schema = v.schema({
  address: v.object({
    city:    v.string(),
    zip:     v.string().digits(5),
    country: v.string().length(2),
  }),
})
```

---

## Bail and Sometimes

```js
// bail() — stop validating all fields after first failure
const validator = Validator.make(data, rules).bail()

// sometimes() — only validate when field is present in input
const validator = Validator.make(data, {
  phone: ['string', 'min:10'],
}).sometimes('phone')
```

---

## Custom Attribute Names

```js
// Replace field names in error messages
const validator = Validator.make(
  data,
  { usr_email: ['required', 'email'] },
  {},                                        // custom messages (empty)
  { usr_email: 'email address' }             // custom attribute names
)
// Error: "The email address field is required." (not "The usr_email field is required.")
```

---

## Custom Error Messages

```js
const validator = Validator.make(data, rules, {
  'email.required': 'We need your email address.',
  'email.email':    'That doesn\'t look like a valid email.',
  'name.min':       'Your name must be at least :min characters.',
  'required':       'The :field field cannot be blank.',  // applies to all required rules
})
```

---

## Framework Adapters

### Express

```js
import { expressValidate, validationErrorHandler } from '@eloquentjs/validator/adapters'

// Route middleware
router.post('/users',
  expressValidate({
    name:  ['required', 'string', 'min:2'],
    email: ['required', 'email'],
  }),
  async (req, res) => {
    // req.validated — only the schema-defined fields
    const user = await User.create(req.validated)
    res.status(201).json(user)
  }
)

// With schema API
router.post('/users', expressValidate(userSchema, { async: true }), handler)

// Validate query params
router.get('/users', expressValidate(filterSchema, { source: 'query' }), handler)

// Global error handler — mount after routes
app.use(validationErrorHandler)
// Returns: 422 { message: 'The given data was invalid.', errors: { field: [...] } }
```

### Fastify

```js
import { fastifyValidate, fastifyValidationPlugin } from '@eloquentjs/validator/adapters'

// Route-level hook
fastify.post('/users', {
  preHandler: fastifyValidate(userSchema, { async: true }),
}, async (req, reply) => {
  const user = await User.create(req.validated)
  reply.send(user)
})

// Global error handler plugin
await fastify.register(fastifyValidationPlugin)
```

---

## Convenience Shorthands

```js
import { validate, validateAsync } from '@eloquentjs/validator'

// Throws ValidationException immediately
const data = validate(input, { name: ['required', 'string'] })

// Async version
const data = await validateAsync(input, {
  email: ['required', 'email', Rule.unique('users', 'email')],
})
```

---

## Named Rule Convenience Groups

```js
import { emailRules, passwordRules, slugRules } from '@eloquentjs/validator/rules'

const rules = {
  email:    emailRules(),    // [required, string, email, max(255)]
  password: passwordRules(), // [required, string, min(8)]
  slug:     slugRules(),     // [required, string, regex(/^[a-z0-9-]+$/), max(255)]
}
```

---

## Error Structure

`ValidationException` has an `errors` property — an object mapping field names to arrays of error strings:

```js
{
  name:    ['The name field is required.'],
  email:   ['The email must be a valid email address.', 'The email has already been taken.'],
  address: {
    zip: ['The address.zip must be 5 digits.']
  }
}
```

---

## Extending the Core Validator

`@eloquentjs/validator`'s `Validator` extends `@eloquentjs/core`'s built-in sync `Validator`. All 25+ core rules still work. This package adds:

- Async validation (`validateAsync`, `validatedAsync`, `failsAsync`)
- 20+ new rules (digits, uuid, ip, json, timezone, alpha, starts_with, before, gt, required_with, etc.)
- Rule object support (custom class-based rules)
- Nested dot-notation fields
- Bail mode and sometimes mode
- Custom attribute display names
- Framework adapters (Express, Fastify)
- DB-backed `unique` / `exists` (via `@eloquentjs/core` connection)

---

## License

MIT
