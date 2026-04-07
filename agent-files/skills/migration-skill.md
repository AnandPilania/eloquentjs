# EloquentJS Migration Skill

## When to use this skill
Use when creating, running, or rolling back database schema migrations.

---

## CLI Commands

```bash
eloquent make:migration <name>       # create migration file (smart template)
eloquent migrate                     # run all pending migrations
eloquent migrate:rollback            # undo last batch
eloquent migrate:rollback --step=3   # undo last 3 batches
eloquent migrate:reset               # rollback every batch (all migrations)
eloquent migrate:refresh             # reset + re-run all
eloquent migrate:refresh --seed      # reset + re-run + seed
eloquent migrate:fresh               # drop all tables + re-run
eloquent migrate:fresh --seed        # drop all + re-run + seed (dev reset)
eloquent migrate:status              # see which have run and which are pending
```

---

## Smart Template Names

The CLI detects intent from the migration name:

```bash
eloquent make:migration create_users_table       # CREATE TABLE template
eloquent make:migration add_avatar_to_users      # ALTER TABLE ADD COLUMN
eloquent make:migration drop_bio_from_profiles   # ALTER TABLE DROP COLUMN
eloquent make:migration rename_posts_to_articles # RENAME TABLE
eloquent make:migration drop_old_logs_table      # DROP TABLE
eloquent make:migration any_other_name           # generic empty template
```

---

## Migration File Structure

```js
// database/migrations/20240321123456_create_users_table.js
import { Migration, Schema } from '@eloquentjs/core'

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create('users', t => {
      // Add columns here
    })
  }

  async down() {
    await Schema.dropIfExists('users')
  }
}
```

---

## Column Types Reference

```js
await Schema.create('products', t => {
  // Primary keys
  t.id()                             // BIGSERIAL PRIMARY KEY (auto-increment)
  t.uuid('id')                       // UUID PRIMARY KEY (+ .default('gen_random_uuid()'))
  t.increments('id')                 // SERIAL PRIMARY KEY

  // Strings
  t.string('name')                   // VARCHAR(255)
  t.string('code', 10)               // VARCHAR(10)
  t.char('country', 2)               // CHAR(2)
  t.text('description')              // TEXT
  t.longText('body')                 // TEXT (alias)

  // Numbers
  t.integer('quantity')              // INTEGER
  t.bigInteger('views')              // BIGINT
  t.smallInteger('priority')         // SMALLINT
  t.unsignedInteger('stock')         // INTEGER CHECK >= 0
  t.float('rating')                  // FLOAT
  t.double('precision_value')        // DOUBLE PRECISION
  t.decimal('price', 10, 2)          // DECIMAL(10, 2)

  // Booleans & Dates
  t.boolean('is_active').default(true)
  t.date('born_at')
  t.time('opens_at')
  t.timestamp('sent_at')
  t.timestampTz('event_at')          // TIMESTAMPTZ

  // JSON
  t.json('settings')
  t.jsonb('metadata')                // JSONB (indexable)

  // Binary
  t.binary('file_data')

  // Enum
  t.enum('status', ['draft', 'published', 'archived'])

  // UUID (non-primary)
  t.uuidColumn('external_id')

  // Specials
  t.timestamps()                     // created_at + updated_at TIMESTAMPTZ
  t.softDeletes()                    // deleted_at TIMESTAMPTZ NULLABLE
  t.softDeletes('archived_at')       // custom column name

  // Modifiers (chain on any column)
  t.string('slug').unique()
  t.text('bio').nullable()
  t.integer('score').default(0)
  t.string('type').after('name')     // position (MySQL only)
  t.integer('rank').comment('1-10')

  // Indexes
  t.index('email')                   // single column index
  t.index(['first_name', 'last_name']) // composite index
  t.unique('email')
  t.unique(['user_id', 'role_id'])

  // Foreign keys
  t.integer('user_id').unsigned()
  t.foreignId('user_id').constrained('users')
  t.foreignId('user_id').constrained('users').cascadeOnDelete()
  t.foreignId('user_id').constrained('users').nullOnDelete()
})
```

---

## Alter Table

```js
await Schema.table('users', t => {
  // Add columns
  t.string('avatar_url').nullable()
  t.boolean('email_verified').default(false)

  // Drop columns
  t.dropColumn('old_field')
  t.dropColumn('field_a', 'field_b')  // multiple at once

  // Rename columns
  t.renameColumn('bio', 'biography')

  // Add indexes
  t.index('email')
  t.unique(['user_id', 'role'])

  // Drop indexes
  t.dropIndex('users_email_index')
  t.dropUnique('users_email_unique')

  // Drop foreign keys
  t.dropForeign('user_id')

  // Drop timestamps/soft deletes
  t.dropTimestamps()
  t.dropSoftDeletes()
})
```

---

## Migration Status & Safety

```js
// Check what's run before deploying
eloquent migrate:status

// Sample output:
// ✔  20240310_create_users_table         batch 1
// ✔  20240311_create_posts_table         batch 1
// ●  20240320_add_avatar_to_users        PENDING
// ●  20240321_add_views_to_posts         PENDING
```

**Production safety checklist:**
- ✅ Adding nullable columns — safe, no downtime
- ✅ Adding columns with defaults — safe
- ✅ Adding indexes — safe (may be slow on large tables)
- ⚠️  Adding NOT NULL columns without defaults — will fail if table has rows
- ⚠️  Dropping columns — data loss, may break running code
- ⚠️  Renaming tables — breaks all running queries against that table
- ❌  Dropping tables — data loss

**Always back up data before:**
- Dropping columns or tables
- Renaming columns that are used in queries

---

## Concurrency Protection

EloquentJS automatically uses `pg_try_advisory_lock` to prevent two deploy processes from running migrations simultaneously. If another process is already migrating:

```
Error: Another migration process is running. Please wait and try again.
```

---

## Tracking Table

Migrations are tracked in the `_migrations` table (created automatically):

```sql
SELECT * FROM _migrations ORDER BY id;
-- id | migration                               | batch | ran_at
--  1 | 20240310123456_create_users_table.js    |     1 | 2024-03-10 12:34:56
--  2 | 20240311000000_create_posts_table.js    |     1 | 2024-03-10 12:34:57
--  3 | 20240320000000_add_avatar_to_users.js   |     2 | 2024-03-20 09:00:00
```

Rollback removes the highest batch. `migrate:reset` removes all.

---

## Schema Inspection

```js
import { Schema } from '@eloquentjs/core'

await Schema.hasTable('users')              // → true
await Schema.hasColumn('users', 'email')    // → true
await Schema.getColumnListing('users')      // → ['id', 'name', 'email', ...]
await Schema.rename('old_table', 'new')     // rename table
await Schema.drop('table_name')             // drop table (error if not exists)
await Schema.dropIfExists('table_name')     // drop table (safe)
```
