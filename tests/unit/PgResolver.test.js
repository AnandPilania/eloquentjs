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
