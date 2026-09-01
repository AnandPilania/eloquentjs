/**
 * Unit tests — PostgreSQL SQL Builder
 *
 * Exercises buildSelect() and buildWhereClauses() directly through
 * the PgResolver.toSQL() method to verify correct SQL and parameter
 * numbering without a real database connection.
 */

// We import the resolver class by re-exporting it from a helper
// Since PgResolver is not exported, we test via a minimal mock pool.
import { PgResolver } from '../../packages/pgsql/src/index.js'

function makeNullPool() {
  return { query: async () => ({ rows: [], rowCount: 0 }) }
}

let resolver

beforeEach(() => {
  resolver = new PgResolver(makeNullPool())
})

// Helper to get SQL from a context object
async function sql(table, ctx) {
  return resolver.toSQL(table, ctx)
}

// ─── Basic SELECT ─────────────────────────────────────────────────────────────
describe('SELECT generation', () => {
  test('simple SELECT *', async () => {
    const { sql: s } = await sql('users', { selects: ['*'], wheres: [] })
    expect(s).toBe('SELECT * FROM "users"')
  })

  test('SELECT specific columns', async () => {
    const { sql: s } = await sql('users', { selects: ['id', 'name', 'email'], wheres: [] })
    expect(s).toBe('SELECT "id", "name", "email" FROM "users"')
  })

  test('SELECT DISTINCT', async () => {
    const { sql: s } = await sql('users', { selects: ['country'], wheres: [], distinct: true })
    expect(s).toContain('SELECT DISTINCT')
  })

  test('raw select expression', async () => {
    const { sql: s } = await sql('users', {
      selects: [{ raw: 'COUNT(*) AS _agg' }],
      wheres: [],
    })
    expect(s).toContain('COUNT(*) AS _agg')
  })
})

// ─── WHERE clauses ────────────────────────────────────────────────────────────
describe('WHERE clauses', () => {
  test('simple equality where — $1 parameter', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ column: 'name', operator: '=', value: 'Alice', boolean: 'and' }],
    })
    expect(s).toBe('SELECT * FROM "users" WHERE "name" = $1')
    expect(params).toEqual(['Alice'])
  })

  test('multiple wheres — parameters increment correctly', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'name',   operator: '=',  value: 'Alice', boolean: 'and' },
        { column: 'active', operator: '=',  value: true,    boolean: 'and' },
        { column: 'age',    operator: '>',  value: 18,      boolean: 'and' },
      ],
    })
    expect(s).toBe('SELECT * FROM "users" WHERE "name" = $1 AND "active" = $2 AND "age" > $3')
    expect(params).toEqual(['Alice', true, 18])
  })

  test('OR where clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'name', operator: '=', value: 'Alice', boolean: 'and' },
        { column: 'name', operator: '=', value: 'Bob',   boolean: 'or' },
      ],
    })
    expect(s).toContain('OR')
    expect(s).toContain('"name" = $1')
    expect(s).toContain('"name" = $2')
  })

  test('whereNull', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'null', column: 'deleted_at', boolean: 'and' }],
    })
    expect(s).toContain('"deleted_at" IS NULL')
    expect(params).toHaveLength(0)
  })

  test('whereNotNull', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'notNull', column: 'email_verified_at', boolean: 'and' }],
    })
    expect(s).toContain('"email_verified_at" IS NOT NULL')
  })

  test('whereIn — uses IN (...)', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'in', column: 'id', values: [1, 2, 3], boolean: 'and' }],
    })
    expect(s).toContain('"id" IN ($1, $2, $3)')
    expect(params).toEqual([1, 2, 3])
  })

  test('whereIn with empty values → 1=0', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'in', column: 'id', values: [], boolean: 'and' }],
    })
    expect(s).toContain('1=0')
  })

  test('whereNotIn with empty values → 1=1', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'notIn', column: 'id', values: [], boolean: 'and' }],
    })
    expect(s).toContain('1=1')
  })

  test('whereBetween — BETWEEN $1 AND $2', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'between', column: 'age', min: 18, max: 65, boolean: 'and' }],
    })
    expect(s).toContain('"age" BETWEEN $1 AND $2')
    expect(params).toEqual([18, 65])
  })

  test('whereDate — casts to ::date', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'date', column: 'created_at', operator: '=', value: '2024-01-01', boolean: 'and' }],
    })
    expect(s).toContain('"created_at"::date = $1')
  })

  test('whereYear — EXTRACT(YEAR FROM ...)', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'year', column: 'created_at', value: 2024, boolean: 'and' }],
    })
    expect(s).toContain('EXTRACT(YEAR FROM "created_at") = $1')
    expect(params).toEqual([2024])
  })

  test('whereJsonContains — @> ::jsonb', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'jsonContains', column: 'settings', value: { theme: 'dark' }, boolean: 'and' }],
    })
    expect(s).toContain('"settings" @> $1::jsonb')
    expect(params[0]).toBe('{"theme":"dark"}')
  })

  test('rawWhere — replaces ? with $N', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [],
      rawWheres: [{ sql: 'LOWER(email) = ?', bindings: ['alice@test.com'] }],
    })
    expect(s).toContain('LOWER(email) = $1')
    expect(params).toEqual(['alice@test.com'])
  })
})

// ─── Critical: multi-clause parameter numbering ───────────────────────────────
describe('CRITICAL: Parameter numbering continuity', () => {
  test('WHERE + HAVING + LIMIT + OFFSET all get unique $N', async () => {
    const { sql: s, params } = await sql('orders', {
      selects: ['*'],
      wheres: [
        { column: 'user_id',  operator: '=', value: 5,    boolean: 'and' },
        { column: 'status',   operator: '=', value: 'paid', boolean: 'and' },
      ],
      rawWheres: [],
      groupBys: ['status'],
      havings: [{ column: 'total', operator: '>', value: 100 }],
      orderBys: [],
      limit: 10,
      offset: 20,
    })

    // WHERE uses $1, $2 → HAVING uses $3 → LIMIT uses $4 → OFFSET uses $5
    expect(s).toContain('"user_id" = $1')
    expect(s).toContain('"status" = $2')
    expect(s).toContain('"total" > $3')
    expect(s).toContain('LIMIT $4')
    expect(s).toContain('OFFSET $5')
    expect(params).toEqual([5, 'paid', 100, 10, 20])
  })

  test('whereIn + normal where — parameters stay in order', async () => {
    const { sql: s, params } = await sql('posts', {
      selects: ['*'],
      wheres: [
        { type: 'in',   column: 'tag_id', values: [10, 20, 30], boolean: 'and' },
        { column: 'published', operator: '=', value: true, boolean: 'and' },
      ],
      rawWheres: [],
      groupBys: [],
      havings: [],
      orderBys: [],
      limit: 5,
      offset: null,
    })

    expect(params).toEqual([10, 20, 30, true, 5])
    expect(s).toContain('"tag_id" IN ($1, $2, $3)')
    expect(s).toContain('"published" = $4')
    expect(s).toContain('LIMIT $5')
  })

  test('whereBetween + normal where + limit', async () => {
    const { sql: s, params } = await sql('products', {
      selects: ['*'],
      wheres: [
        { type: 'between', column: 'price', min: 10, max: 100, boolean: 'and' },
        { column: 'active', operator: '=', value: true, boolean: 'and' },
      ],
      rawWheres: [],
      groupBys: [],
      havings: [],
      orderBys: [],
      limit: 25,
      offset: null,
    })

    expect(params).toEqual([10, 100, true, 25])
    expect(s).toContain('"price" BETWEEN $1 AND $2')
    expect(s).toContain('"active" = $3')
    expect(s).toContain('LIMIT $4')
  })
})

// ─── ORDER BY ─────────────────────────────────────────────────────────────────
describe('ORDER BY generation', () => {
  test('single ORDER BY', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      orderBys: [{ column: 'name', direction: 'ASC' }],
    })
    expect(s).toContain('ORDER BY "name" ASC')
  })

  test('multiple ORDER BY — SINGLE ORDER BY clause with commas', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      orderBys: [
        { column: 'country', direction: 'ASC' },
        { column: 'name',    direction: 'DESC' },
        { column: 'id',      direction: 'ASC' },
      ],
    })
    // Must be ONE "ORDER BY" keyword followed by comma-separated parts
    const matches = s.match(/ORDER BY/g)
    expect(matches).toHaveLength(1)
    expect(s).toContain('ORDER BY "country" ASC, "name" DESC, "id" ASC')
  })

  test('ORDER BY RANDOM()', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      orderBys: [{ random: true }],
    })
    expect(s).toContain('ORDER BY RANDOM()')
  })

  test('raw ORDER BY expression', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      orderBys: [{ raw: 'LOWER(name) ASC' }],
    })
    expect(s).toContain('ORDER BY LOWER(name) ASC')
  })
})

// ─── JOINs ────────────────────────────────────────────────────────────────────
describe('JOIN generation', () => {
  test('INNER JOIN with correct quoting', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      joins: [{ type: 'INNER', table: 'posts', first: 'users.id', operator: '=', second: 'posts.user_id' }],
    })
    expect(s).toContain('INNER JOIN "posts" ON "users"."id" = "posts"."user_id"')
  })

  test('LEFT JOIN', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      joins: [{ type: 'LEFT', table: 'profiles', first: 'users.id', operator: '=', second: 'profiles.user_id' }],
    })
    expect(s).toContain('LEFT JOIN')
  })

  test('CROSS JOIN has no ON clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      joins: [{ type: 'CROSS', table: 'sizes' }],
    })
    expect(s).toContain('CROSS JOIN "sizes"')
    expect(s).not.toContain('ON')
  })

  test('JOIN + WHERE params do not conflict', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      joins: [{ type: 'INNER', table: 'posts', first: 'users.id', operator: '=', second: 'posts.user_id' }],
      wheres: [
        { column: 'users.active', operator: '=', value: true,    boolean: 'and' },
        { column: 'posts.published', operator: '=', value: true, boolean: 'and' },
      ],
      rawWheres: [],
      groupBys: [],
      havings: [],
      orderBys: [],
      limit: 10,
    })
    // $1 and $2 are the WHERE params, $3 is LIMIT
    expect(params).toEqual([true, true, 10])
    expect(s).toContain('$1')
    expect(s).toContain('$2')
    expect(s).toContain('LIMIT $3')
  })
})

// ─── UPDATE / DELETE builder ──────────────────────────────────────────────────
describe('UPDATE / DELETE param numbering', () => {
  test('update() with ctx: SET params then WHERE params in order', async () => {
    const capturedSQL = []
    const pool = {
      async query(sql, params) {
        capturedSQL.push({ sql, params })
        return { rows: [], rowCount: 1 }
      }
    }
    const r = new PgResolver(pool)

    await r.update('users', null, { name: 'Alice', email: 'a@a.com' }, {
      wheres: [{ column: 'id', operator: '=', value: 99, boolean: 'and' }],
      rawWheres: [],
    })

    const { sql: s, params: p } = capturedSQL[0]
    // SET uses $1, $2 → WHERE uses $3
    expect(p).toEqual(['Alice', 'a@a.com', 99])
    expect(s).toContain('"name" = $1')
    expect(s).toContain('"email" = $2')
    expect(s).toContain('"id" = $3')
  })

  test('increment() with extra SET fields', async () => {
    const capturedSQL = []
    const pool = {
      async query(sql, params) { capturedSQL.push({ sql, params }); return { rowCount: 1 } }
    }
    const r = new PgResolver(pool)

    await r.increment('posts', 'views', 1, { updated_at: 'now' }, {
      wheres: [{ column: 'id', operator: '=', value: 5, boolean: 'and' }],
      rawWheres: [],
    })

    const { params: p, sql: s } = capturedSQL[0]
    // $1=amount, $2=updated_at, $3=id (WHERE)
    expect(p).toEqual([1, 'now', 5])
    expect(s).toContain('"views" = "views" + $1')
    expect(s).toContain('"updated_at" = $2')
    expect(s).toContain('"id" = $3')
  })
})

// ─── Identifier quoting ───────────────────────────────────────────────────────
describe('Identifier quoting', () => {
  test('table.column notation is split and each part quoted', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      joins: [{ type: 'INNER', table: 'posts', first: 'users.id', operator: '=', second: 'posts.user_id' }],
    })
    // Should produce "users"."id" not "users.id"
    expect(s).toContain('"users"."id"')
    expect(s).toContain('"posts"."user_id"')
  })
})

// ─── Nested where groups ──────────────────────────────────────────────────────
describe('Nested where groups', () => {
  test('group is parenthesized and params keep numbering', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { type: 'null', column: 'deleted_at', boolean: 'and' },
        { type: 'group', boolean: 'and', wheres: [
          { column: 'name', operator: 'LIKE', value: '%a%', boolean: 'and' },
          { column: 'email', operator: 'LIKE', value: '%a%', boolean: 'or' },
        ] },
      ],
    })
    expect(s).toBe(
      'SELECT * FROM "users" WHERE "deleted_at" IS NULL '
      + 'AND ("name" LIKE $1 OR "email" LIKE $2)'
    )
    expect(params).toEqual(['%a%', '%a%'])
  })

  test('params before and after a group stay sequential', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'a', operator: '=', value: 1, boolean: 'and' },
        { type: 'group', boolean: 'and', wheres: [
          { column: 'b', operator: '=', value: 2, boolean: 'and' },
        ] },
        { column: 'c', operator: '=', value: 3, boolean: 'and' },
      ],
      limit: 10,
    })
    expect(s).toContain('"a" = $1 AND ("b" = $2) AND "c" = $3')
    expect(s).toContain('LIMIT $4')
    expect(params).toEqual([1, 2, 3, 10])
  })

  test('nested groups recurse', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'group', boolean: 'and', wheres: [
        { column: 'a', operator: '=', value: 1, boolean: 'and' },
        { type: 'group', boolean: 'or', wheres: [
          { column: 'b', operator: '=', value: 2, boolean: 'and' },
          { column: 'c', operator: '=', value: 3, boolean: 'and' },
        ] },
      ] }],
    })
    expect(s).toContain('WHERE ("a" = $1 OR ("b" = $2 AND "c" = $3))')
    expect(params).toEqual([1, 2, 3])
  })

  test('an empty group emits no clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'group', boolean: 'and', wheres: [] }],
    })
    expect(s).toBe('SELECT * FROM "users"')
  })
})

// ─── HAVING ───────────────────────────────────────────────────────────────────
describe('HAVING', () => {
  test('multiple havings are AND-ed into one clause', async () => {
    const { sql: s, params } = await sql('orders', {
      selects: [{ raw: 'user_id, SUM(total) AS t' }],
      wheres: [],
      groupBys: ['user_id'],
      havings: [
        { column: 'total', operator: '>', value: 100 },
        { column: 'total', operator: '<', value: 900 },
      ],
    })
    expect(s.match(/HAVING/g)).toHaveLength(1)
    expect(s).toContain('HAVING "total" > $1 AND "total" < $2')
    expect(params).toEqual([100, 900])
  })
})

// ─── Bulk insert ──────────────────────────────────────────────────────────────
describe('insertMany', () => {
  test('one statement, one tuple per row, sequential params', async () => {
    const seen = []
    const r = new PgResolver({ query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] } } })
    await r.insertMany('users', [{ name: 'a', age: 1 }, { name: 'b', age: 2 }])
    expect(seen).toHaveLength(1)
    expect(seen[0].sql).toBe(
      'INSERT INTO "users" ("name", "age") VALUES ($1, $2), ($3, $4) RETURNING *'
    )
    expect(seen[0].params).toEqual(['a', 1, 'b', 2])
  })

  test('column set is the union of row keys; missing keys become NULL', async () => {
    const seen = []
    const r = new PgResolver({ query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] } } })
    await r.insertMany('users', [{ name: 'a' }, { name: 'b', age: 2 }])
    expect(seen[0].sql).toContain('("name", "age")')
    expect(seen[0].params).toEqual(['a', null, 'b', 2])
  })

  test('falsy-but-present values are preserved', async () => {
    const seen = []
    const r = new PgResolver({ query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] } } })
    await r.insertMany('users', [{ active: false, n: 0 }])
    expect(seen[0].params).toEqual([false, 0])
  })

  test('empty input is a no-op', async () => {
    const seen = []
    const r = new PgResolver({ query: async () => { seen.push(1); return { rows: [] } } })
    expect(await r.insertMany('users', [])).toEqual([])
    expect(seen).toHaveLength(0)
  })
})

// ─── Column defaults ──────────────────────────────────────────────────────────
describe('Column DEFAULT rendering', () => {
  const ddl = async (col) => {
    const seen = []
    const r = new PgResolver({ query: async (sql) => { seen.push(sql); return { rows: [] } } })
    await r.createTable('t', { columns: [{ name: 'c', type: 'string', _nullable: true, ...col }], foreigns: [], indexes: [] })
    return seen.join('\n')
  }

  test('string literal defaults are quoted', async () => {
    expect(await ddl({ _default: 'active' })).toContain("DEFAULT 'active'")
  })

  test('quotes inside a literal are escaped', async () => {
    expect(await ddl({ _default: "O'Brien" })).toContain("DEFAULT 'O''Brien'")
  })

  test('function-call defaults pass through raw', async () => {
    expect(await ddl({ _default: 'gen_random_uuid()' })).toContain('DEFAULT gen_random_uuid()')
  })

  test('CURRENT_TIMESTAMP passes through raw', async () => {
    expect(await ddl({ _default: 'CURRENT_TIMESTAMP' })).toContain('DEFAULT CURRENT_TIMESTAMP')
  })

  test('numbers are unquoted', async () => {
    expect(await ddl({ _default: 5 })).toContain('DEFAULT 5')
  })

  test('booleans render as TRUE/FALSE', async () => {
    expect(await ddl({ _default: false })).toContain('DEFAULT FALSE')
  })
})

// ─── Primary key on auto-increment columns ───────────────────────────────────
// BIGSERIAL/SERIAL only creates the sequence default — unlike SQLite's
// INTEGER PRIMARY KEY AUTOINCREMENT, Postgres still needs an explicit PRIMARY
// KEY. Schema.create('x', t => t.id()) — the first line of nearly every
// migration — used to render `"id" BIGSERIAL` with no constraint at all, so
// the table had no primary key and any `constrained('x')` FK pointing at it
// failed with "no unique constraint matching given keys".
describe('t.id() / bigIncrements() / increments() get an actual PRIMARY KEY', () => {
  const ddl = async (col) => {
    const seen = []
    const r = new PgResolver({ query: async (sql) => { seen.push(sql); return { rows: [] } } })
    await r.createTable('t', { columns: [{ name: 'id', primaryKey: true, ...col }], foreigns: [], indexes: [] })
    return seen.join('\n')
  }

  test('t.id() → BIGSERIAL PRIMARY KEY', async () => {
    const sql = await ddl({ type: 'bigIncrements' })
    expect(sql).toContain('"id" BIGSERIAL PRIMARY KEY')
  })

  test('t.increments() → SERIAL PRIMARY KEY', async () => {
    const sql = await ddl({ type: 'increments' })
    expect(sql).toContain('"id" SERIAL PRIMARY KEY')
  })
})
