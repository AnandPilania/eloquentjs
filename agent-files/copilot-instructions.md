# EloquentJS — GitHub Copilot Instructions

## Context
This is a Node.js project using EloquentJS ORM (Laravel Eloquent port).
All database code uses the EloquentJS API. All files use ES modules (`import`/`export`).

## Model Pattern
```js
// app/models/[ModelName].js — always PascalCase, default export
import { Model } from '@eloquentjs/core'

export default class [ModelName] extends Model {
  static table    = '[table_name]'          // snake_plural
  static fillable = ['field1', 'field2']    // allowed for mass assignment
  static casts    = { field: 'type' }       // auto-cast on read/write
  static softDeletes = false                // true = soft delete support

  // Relations: hasOne, hasMany, belongsTo, belongsToMany, morphTo, morphMany
  related() { return this.hasMany(RelatedModel) }

  // Scopes: static scopeXxx(qb) — called as Model.xxx().get()
  static scopeActive(qb) { return qb.where('active', true) }

  // Hooks: creating, created, updating, updated, deleting, deleted
  static async creating(record) { /* runs before insert */ }
}
```

## Query Patterns
```js
// List with filters and pagination
await Model.where('status', 'active')
  .with('relation')
  .orderBy('created_at', 'desc')
  .paginate(page, perPage)

// Single record (throws if missing)
await Model.findOrFail(id)

// Create with validation
const data = schema.parse(req.body)
await Model.create(data)

// Update
const record = await Model.findOrFail(id)
await record.update(req.body)

// Soft delete
await record.delete()    // sets deleted_at
await record.restore()   // clears deleted_at
```

## Validation Pattern
```js
import { v } from '@eloquentjs/validator'

const schema = v.schema({
  name:  v.string().min(2).max(255),
  email: v.string().email(),
  // For async DB checks (unique/exists) use parseAsync()
  slug:  v.string().alphaDash().unique('table', 'slug'),
})

// Sync (no async rules)
const data = schema.parse(input)

// Async (when using .unique(), .exists(), or custom async rules)
const data = await schema.parseAsync(input)
```

## REST Route Pattern
```js
import { apiRouter, resource } from '@eloquentjs/api'

// One line generates GET/POST/PUT/PATCH/DELETE routes
app.use('/api', apiRouter([
  resource(ModelClass, { middleware: [], with: [], searchable: [], sortable: [] }),
]))
```

## Migration Pattern
```js
// database/migrations/[timestamp]_[description].js
import { Migration, Schema } from '@eloquentjs/core'

export default class [ClassName] extends Migration {
  async up() {
    await Schema.create('table', t => {
      t.id()
      t.string('name')
      t.timestamps()
    })
  }
  async down() {
    await Schema.dropIfExists('table')
  }
}
```

## Key Rules for Completions
- All Model/DB calls must be `await`ed
- Always `.with()` relations that will be used after fetch
- Declare `fillable` on every model used with `create()`/`update()`
- Use `findOrFail()` when absence is an error; `find()` when null is valid
- Validate input before passing to ORM — use `@eloquentjs/validator`
- Transactions via `import { transaction } from '@eloquentjs/pgsql'`
