/**
 * Unit tests — SQLite SQL Builder (@eloquentjs/sqlite)
 *
 * Exercises buildSelect()/buildWhereClauses() through SQLiteResolver.toSQL()
 * and the INSERT/UPDATE/DELETE/INCREMENT builders through a mock better-sqlite3
 * database. SQLite uses positional `?` placeholders. No native binary required.
 */

import { SQLiteResolver } from '../../packages/sqlite/src/index.js'

// Mock db: prepare() returns a statement whose run/get/all capture calls.
function makeMockDb(captured = []) {
  return {
    prepare(sql) {
      return {
        reader: /^\s*select/i.test(sql),
        all(...params) { captured.push({ sql, params }); return [] },
        get(...params) { captured.push({ sql, params }); return { id: 1 } },
        run(...params) { captured.push({ sql, params }); return { changes: 1, lastInsertRowid: 1 } },
      }
    },
  }
}

let resolver
beforeEach(() => { resolver = new SQLiteResolver(makeMockDb()) })

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
        { column: 'role', operator: '=', value: 'admin', boolean: 'and' },
        { column: 'age', operator: '>', value: 18, boolean: 'and' },
      ],
    })
    expect(s).toBe('SELECT * FROM "users" WHERE "name" = ? AND "role" = ? AND "age" > ?')
    expect(params).toEqual(['Alice', 'admin', 18])
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

  test('whereYear — strftime (string param, no CAST)', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'year', column: 'created_at', value: 2024, boolean: 'and' }],
    })
    expect(s).toContain(`strftime('%Y', "created_at") = ?`)
    expect(params).toEqual(['2024'])
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

describe('positional parameter order', () => {
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
        { column: 'status', operator: '=', value: 'published', boolean: 'and' },
      ],
      rawWheres: [], groupBys: [], havings: [], orderBys: [], limit: 5, offset: null,
    })
    expect(params).toEqual([10, 20, 30, 'published', 5])
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

describe('INSERT / UPDATE / DELETE / INCREMENT', () => {
  test('insert() builds INSERT with ? placeholders (no RETURNING)', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.insert('users', { name: 'Bob', email: 'b@b.com' })
    const insertWrite = captured.find(c => c.sql.startsWith('INSERT'))
    expect(insertWrite.sql).toBe('INSERT INTO "users" ("name", "email") VALUES (?, ?)')
    expect(insertWrite.sql).not.toContain('RETURNING')
    expect(insertWrite.params).toEqual(['Bob', 'b@b.com'])
  })

  test('update() with ctx: SET params then WHERE params', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    const changes = await r.update('users', null, { name: 'Alice', email: 'a@a.com' }, {
      wheres: [{ column: 'id', operator: '=', value: 99, boolean: 'and' }], rawWheres: [],
    })
    const { sql: s, params } = captured[0]
    expect(s).toContain('UPDATE "users" SET "name" = ?, "email" = ?')
    expect(s).toContain('WHERE "id" = ?')
    expect(params).toEqual(['Alice', 'a@a.com', 99])
    expect(changes).toBe(1)
  })

  test('delete() with ctx', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.delete('users', null, { wheres: [{ column: 'id', operator: '=', value: 7, boolean: 'and' }], rawWheres: [] })
    const { sql: s, params } = captured[0]
    expect(s).toContain('DELETE FROM "users" WHERE "id" = ?')
    expect(params).toEqual([7])
  })

  test('increment() with extra SET fields: amount, extra, where', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.increment('posts', 'views', 1, { slug: 'hello' }, {
      wheres: [{ column: 'id', operator: '=', value: 5, boolean: 'and' }], rawWheres: [],
    })
    const { sql: s, params } = captured[0]
    expect(s).toContain('"views" = "views" + ?')
    expect(params).toEqual([1, 'hello', 5])
  })
})

describe('DDL generation', () => {
  test('createTable: increments → INTEGER PRIMARY KEY AUTOINCREMENT', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.createTable('users', {
      columns: [
        { name: 'id', type: 'bigIncrements', primaryKey: true },
        { name: 'email', type: 'string', _nullable: false, _unique: true },
      ],
      indexes: [], foreigns: [],
    })
    const create = captured.find(c => c.sql.startsWith('CREATE TABLE'))
    expect(create.sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(create.sql).toContain('"email" TEXT NOT NULL UNIQUE')
  })

  test('dropTable ifExists', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.dropTable('users', { ifExists: true })
    expect(captured[0].sql).toBe('DROP TABLE IF EXISTS "users"')
  })
})

// ─── Nested where groups ──────────────────────────────────────────────────────
describe('Nested where groups', () => {
  test('group is parenthesized and bindings stay positional', async () => {
    const { sql: s, params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { type: 'null', column: 'deleted_at', boolean: 'and' },
        { type: 'group', boolean: 'and', wheres: [
          { column: 'name', operator: 'LIKE', value: '%a%', boolean: 'and' },
          { column: 'email', operator: 'LIKE', value: '%b%', boolean: 'or' },
        ] },
      ],
    })
    expect(s).toBe(
      'SELECT * FROM "users" WHERE "deleted_at" IS NULL '
      + 'AND ("name" LIKE ? OR "email" LIKE ?)'
    )
    expect(params).toEqual(['%a%', '%b%'])
  })

  test('binding order follows clause order across a group', async () => {
    const { params } = await sql('users', {
      selects: ['*'],
      wheres: [
        { column: 'a', operator: '=', value: 1, boolean: 'and' },
        { type: 'group', boolean: 'and', wheres: [{ column: 'b', operator: '=', value: 2, boolean: 'and' }] },
        { column: 'c', operator: '=', value: 3, boolean: 'and' },
      ],
      limit: 10,
    })
    expect(params).toEqual([1, 2, 3, 10])
  })

  test('an empty group emits no clause', async () => {
    const { sql: s } = await sql('users', {
      selects: ['*'],
      wheres: [{ type: 'group', boolean: 'and', wheres: [] }],
    })
    expect(s).toBe('SELECT * FROM "users"')
  })
})

// ─── Bulk insert ──────────────────────────────────────────────────────────────
describe('insertMany', () => {
  test('one statement, one tuple per row', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.insertMany('users', [{ name: 'a', age: 1 }, { name: 'b', age: 2 }])
    expect(captured).toHaveLength(1)
    expect(captured[0].sql).toBe(
      'INSERT INTO "users" ("name", "age") VALUES (?, ?), (?, ?) RETURNING *'
    )
    expect(captured[0].params).toEqual(['a', 1, 'b', 2])
  })

  test('missing keys become NULL', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.insertMany('users', [{ name: 'a' }, { name: 'b', age: 2 }])
    expect(captured[0].params).toEqual(['a', null, 'b', 2])
  })

  test('values go through prepareValue (booleans → 0/1)', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.insertMany('users', [{ active: true }])
    expect(captured[0].params).toEqual([1])
  })

  test('empty input is a no-op', async () => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    expect(await r.insertMany('users', [])).toEqual([])
    expect(captured).toHaveLength(0)
  })
})

// ─── Column defaults ──────────────────────────────────────────────────────────
describe('Column DEFAULT rendering', () => {
  const ddl = async (col) => {
    const captured = []
    const r = new SQLiteResolver(makeMockDb(captured))
    await r.createTable('t', { columns: [{ name: 'c', type: 'string', _nullable: true, ...col }], foreigns: [], indexes: [] })
    return captured.map(c => c.sql).join('\n')
  }

  test('string literal defaults are quoted', async () => {
    expect(await ddl({ _default: 'active' })).toContain("DEFAULT 'active'")
  })

  test("Blueprint's Postgres gen_random_uuid() is translated to a SQLite v4", async () => {
    // SQLite has no uuid function, and `DEFAULT foo()` unparenthesized is a
    // syntax error — emitting the pg expression verbatim breaks CREATE TABLE.
    const sql = await ddl({ _default: 'gen_random_uuid()' })
    expect(sql).not.toContain('gen_random_uuid')
    expect(sql).toContain('randomblob')
    expect(sql).toMatch(/DEFAULT \(lower\(hex\(randomblob/)
  })

  test('other function-call defaults are parenthesized', async () => {
    // SQLite requires non-constant defaults in parens.
    expect(await ddl({ _default: 'unixepoch()' })).toContain('DEFAULT (unixepoch())')
  })

  test('an already-parenthesized expression is not double-wrapped', async () => {
    expect(await ddl({ _default: '(unixepoch())' })).toContain('DEFAULT (unixepoch())')
  })

  test('CURRENT_TIMESTAMP passes through bare', async () => {
    expect(await ddl({ _default: 'CURRENT_TIMESTAMP' })).toContain('DEFAULT CURRENT_TIMESTAMP')
  })

  test('booleans render as 1/0', async () => {
    expect(await ddl({ _default: false })).toContain('DEFAULT 0')
  })

  test('quotes inside a literal are escaped', async () => {
    expect(await ddl({ _default: "O'Brien" })).toContain("DEFAULT 'O''Brien'")
  })
})
