/**
 * Unit tests — SQLite SQL Builder (@eloquentjs/sqlite)
 *
 * Exercises buildSelect()/buildWhere() through SqliteResolver.toSQL() and the
 * UPDATE/DELETE/INCREMENT builders through a mock better-sqlite3 database.
 * SQLite uses positional `?` placeholders, so we assert placeholder text and
 * that params are collected in execution order. No native binary required.
 */

import { SqliteResolver } from '../../packages/sqlite/src/index.js'

// Mock db: prepare() returns a statement whose run/get/all capture calls.
function makeMockDb(captured = []) {
  return {
    prepare(sql) {
      return {
        reader: /^\s*select/i.test(sql),
        all(...params) { captured.push({ sql, params }); return [] },
        get(...params) { captured.push({ sql, params }); return undefined },
        run(...params) { captured.push({ sql, params }); return { changes: 1, lastInsertRowid: 1 } },
      }
    },
    exec(sql) { captured.push({ sql, params: null }) },
  }
}

let resolver
beforeEach(() => { resolver = new SqliteResolver(makeMockDb()) })

async function sql(table, ctx) { return resolver.toSQL(table, ctx) }

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
    const { sql: s } = await sql('users', { selects: [{ raw: 'COUNT(*) AS _agg' }], wheres: [] })
    expect(s).toContain('COUNT(*) AS _agg')
  })
})

describe('WHERE clauses', () => {
  test('simple equality where — ? placeholder', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ column: 'name', operator: '=', value: 'Alice', boolean: 'and' }],
    })
    expect(s).toBe('SELECT * FROM "users" WHERE "name" = ?')
    expect(params).toEqual(['Alice'])
  })

  test('multiple wheres — params collected in order', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'name', operator: '=', value: 'Alice', boolean: 'and' },
        { column: 'active', operator: '=', value: true, boolean: 'and' },
        { column: 'age', operator: '>', value: 18, boolean: 'and' },
      ],
    })
    expect(s).toBe('SELECT * FROM "users" WHERE "name" = ? AND "active" = ? AND "age" > ?')
    expect(params).toEqual(['Alice', true, 18])
  })

  test('OR where clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'name', operator: '=', value: 'Alice', boolean: 'and' },
        { column: 'name', operator: '=', value: 'Bob', boolean: 'or' },
      ],
    })
    expect(s).toContain('OR')
  })

  test('whereNull / whereNotNull', async () => {
    const { sql: a, params } = await sql('users', { selects: ['*'], wheres: [{ type: 'null', column: 'deleted_at', boolean: 'and' }] })
    expect(a).toContain('"deleted_at" IS NULL')
    expect(params).toHaveLength(0)
    const { sql: b } = await sql('users', { selects: ['*'], wheres: [{ type: 'notNull', column: 'email_verified_at', boolean: 'and' }] })
    expect(b).toContain('"email_verified_at" IS NOT NULL')
  })

  test('whereIn — uses IN (?, ?, ?)', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'in', column: 'id', values: [1, 2, 3], boolean: 'and' }],
    })
    expect(s).toContain('"id" IN (?, ?, ?)')
    expect(params).toEqual([1, 2, 3])
  })

  test('whereIn empty → 1=0, whereNotIn empty → 1=1', async () => {
    const { sql: a } = await sql('users', { selects: ['*'], wheres: [{ type: 'in', column: 'id', values: [], boolean: 'and' }] })
    expect(a).toContain('1=0')
    const { sql: b } = await sql('users', { selects: ['*'], wheres: [{ type: 'notIn', column: 'id', values: [], boolean: 'and' }] })
    expect(b).toContain('1=1')
  })

  test('whereBetween — BETWEEN ? AND ?', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'between', column: 'age', min: 18, max: 65, boolean: 'and' }],
    })
    expect(s).toContain('"age" BETWEEN ? AND ?')
    expect(params).toEqual([18, 65])
  })

  test('whereDate — uses date() function', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'date', column: 'created_at', operator: '=', value: '2024-01-01', boolean: 'and' }],
    })
    expect(s).toContain('date("created_at") = ?')
  })

  test('whereYear — strftime', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'year', column: 'created_at', value: 2024, boolean: 'and' }],
    })
    expect(s).toContain(`strftime('%Y', "created_at")`)
    expect(params).toEqual([2024])
  })

  test('rawWhere — keeps ? placeholders and binds in order', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [],
      rawWheres: [{ sql: 'LOWER(email) = ?', bindings: ['alice@test.com'] }],
    })
    expect(s).toContain('LOWER(email) = ?')
    expect(params).toEqual(['alice@test.com'])
  })
})

describe('CRITICAL: positional parameter order', () => {
  test('WHERE + HAVING + LIMIT + OFFSET collected in execution order', async () => {
    const { sql: s, params } = await sql('orders', {
      selects: ['*'],
      wheres: [
        { column: 'user_id', operator: '=', value: 5, boolean: 'and' },
        { column: 'status', operator: '=', value: 'paid', boolean: 'and' },
      ],
      rawWheres: [], groupBys: ['status'],
      havings: [{ column: 'total', operator: '>', value: 100 }],
      orderBys: [], limit: 10, offset: 20,
    })
    expect(s).toContain('LIMIT ?')
    expect(s).toContain('OFFSET ?')
    expect(params).toEqual([5, 'paid', 100, 10, 20])
  })

  test('whereIn + normal where + limit stay in order', async () => {
    const { params } = await sql('posts', {
      selects: ['*'],
      wheres: [
        { type: 'in', column: 'tag_id', values: [10, 20, 30], boolean: 'and' },
        { column: 'published', operator: '=', value: true, boolean: 'and' },
      ],
      rawWheres: [], groupBys: [], havings: [], orderBys: [], limit: 5, offset: null,
    })
    expect(params).toEqual([10, 20, 30, true, 5])
  })

  test('OFFSET without LIMIT emits LIMIT -1 OFFSET ?', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'], wheres: [], limit: null, offset: 15,
    })
    expect(s).toContain('LIMIT -1 OFFSET ?')
    expect(params).toEqual([15])
  })
})

describe('ORDER BY / JOIN', () => {
  test('multiple ORDER BY in one clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      orderBys: [{ column: 'country', direction: 'ASC' }, { column: 'name', direction: 'DESC' }],
    })
    expect(s.match(/ORDER BY/g)).toHaveLength(1)
    expect(s).toContain('ORDER BY "country" ASC, "name" DESC')
  })

  test('ORDER BY RANDOM()', async () => {
    const { sql: s } = await sql('users', { selects: ['*'], wheres: [], orderBys: [{ random: true }] })
    expect(s).toContain('ORDER BY RANDOM()')
  })

  test('INNER JOIN quoting + dotted identifiers', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'], wheres: [],
      joins: [{ type: 'INNER', table: 'posts', first: 'users.id', operator: '=', second: 'posts.user_id' }],
    })
    expect(s).toContain('INNER JOIN "posts" ON "users"."id" = "posts"."user_id"')
  })

  test('CROSS JOIN has no ON clause', async () => {
    const { sql: s } = await sql('users', { selects: ['*'], wheres: [], joins: [{ type: 'CROSS', table: 'sizes' }] })
    expect(s).toContain('CROSS JOIN "sizes"')
    expect(s).not.toContain(' ON ')
  })
})

describe('UPDATE / DELETE / INCREMENT param order', () => {
  test('update() with ctx: SET params then WHERE params', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    const changes = await r.update('users', null, { name: 'Alice', email: 'a@a.com' }, {
      wheres: [{ column: 'id', operator: '=', value: 99, boolean: 'and' }], rawWheres: [],
    })
    const { sql: s, params } = captured[0]
    expect(params).toEqual(['Alice', 'a@a.com', 99])
    expect(s).toContain('"name" = ?')
    expect(s).toContain('WHERE "id" = ?')
    expect(changes).toBe(1)
  })

  test('delete() with ctx', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.delete('users', null, { wheres: [{ column: 'id', operator: '=', value: 7, boolean: 'and' }], rawWheres: [] })
    const { sql: s, params } = captured[0]
    expect(s).toContain('DELETE FROM "users" WHERE "id" = ?')
    expect(params).toEqual([7])
  })

  test('increment() with extra SET fields: amount, extra, where', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.increment('posts', 'views', 1, { updated_at: 'now' }, {
      wheres: [{ column: 'id', operator: '=', value: 5, boolean: 'and' }], rawWheres: [],
    })
    const { sql: s, params } = captured[0]
    expect(params).toEqual([1, 'now', 5])
    expect(s).toContain('"views" = "views" + ?')
  })

  test('insert() builds RETURNING * with placeholders', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.insert('users', { name: 'Bob', email: 'b@b.com' })
    const { sql: s, params } = captured[0]
    expect(s).toContain('INSERT INTO "users" ("name", "email") VALUES (?, ?) RETURNING *')
    expect(params).toEqual(['Bob', 'b@b.com'])
  })
})

describe('DDL generation', () => {
  test('createTable: increments → INTEGER PRIMARY KEY AUTOINCREMENT', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.createTable('users', {
      columns: [
        { name: 'id', type: 'bigIncrements', primaryKey: true },
        { name: 'email', type: 'string', _nullable: false, _unique: true },
        { name: 'active', type: 'boolean', _nullable: false, _default: true },
      ],
      indexes: [], foreigns: [],
    })
    const create = captured[0].sql
    expect(create).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(create).toContain('"email" TEXT NOT NULL UNIQUE')
    expect(create).toContain('"active" INTEGER NOT NULL DEFAULT 1')
  })

  test('createTable: inline FOREIGN KEY constraint', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.createTable('posts', {
      columns: [{ name: 'id', type: 'increments', primaryKey: true }, { name: 'user_id', type: 'bigInteger', _nullable: false }],
      indexes: [],
      foreigns: [{ column: 'user_id', table: 'users', references: 'id', onDelete: 'cascade', onUpdate: 'cascade' }],
    })
    expect(captured[0].sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE')
  })

  test('dropTable ifExists', async () => {
    const captured = []
    const r = new SqliteResolver(makeMockDb(captured))
    await r.dropTable('users', { ifExists: true })
    expect(captured[0].sql).toBe('DROP TABLE IF EXISTS "users"')
  })
})
