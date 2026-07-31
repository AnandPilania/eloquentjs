/**
 * Integration tests — real SQL against a real database.
 *
 * Every other resolver suite uses a mock db, which verifies the SQL *string*
 * but never that SQLite accepts it. This suite runs the generated SQL for real
 * via node:sqlite (built in, no native build needed), which is how the
 * `DEFAULT gen_random_uuid()` syntax error was caught.
 *
 * node:sqlite landed in Node 22.5; the package floor is 20.6, so skip below it.
 */

import { SQLiteResolver } from '../../packages/sqlite/src/index.js'
import { Model, Schema, setResolver, clearResolvers } from '../../packages/core/src/index.js'

let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}

const describeIf = DatabaseSync ? describe : describe.skip

describeIf('SQLite integration (real SQL execution)', () => {
  let db

  class Post extends Model {
    static table = 'posts'
    static fillable = ['title', 'views']
    static softDeletes = true
    static timestamps = false
  }

  const titles = (c) => [...c].map(m => m.title)

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    clearResolvers()
    setResolver(new SQLiteResolver(db))
    db.exec(`CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, views INT, deleted_at TEXT
    )`)
    await Post.insert([
      { title: 'alpha', views: 10 },
      { title: 'beta',  views: 20 },
      { title: 'gamma', views: 30 },
    ])
  })

  afterEach(() => { clearResolvers(); db?.close() })

  describe('bulk insert', () => {
    test('inserts every row', async () => {
      expect(await Post.query().count()).toBe(3)
      expect(titles(await Post.query().get()).sort()).toEqual(['alpha', 'beta', 'gamma'])
    })

    test('heterogeneous rows leave missing columns NULL', async () => {
      await Post.insert([{ title: 'solo' }, { title: 'duo', views: 7 }])
      expect((await Post.where('title', 'solo').first()).views).toBeNull()
      expect((await Post.where('title', 'duo').first()).views).toBe(7)
    })
  })

  describe('soft deletes vs OR precedence', () => {
    beforeEach(async () => {
      await (await Post.where('title', 'gamma').first()).delete()
    })

    test('the trashed row is excluded', async () => {
      expect(await Post.query().count()).toBe(2)
    })

    test('orWhere does not resurrect it', async () => {
      const rows = await Post.where('title', 'alpha').orWhere('title', 'gamma').get()
      expect(titles(rows)).toEqual(['alpha'])
    })

    test('withTrashed reaches it again', async () => {
      const rows = await Post.query().withTrashed()
        .where('title', 'alpha').orWhere('title', 'gamma').get()
      expect(titles(rows).sort()).toEqual(['alpha', 'gamma'])
    })

    test('onlyTrashed returns just it', async () => {
      expect(titles(await Post.query().onlyTrashed().get())).toEqual(['gamma'])
    })
  })

  describe('closure where groups execute', () => {
    test('an OR group inside an AND query', async () => {
      const rows = await Post.where(q => q.where('title', 'alpha').orWhere('title', 'beta')).get()
      expect(titles(rows).sort()).toEqual(['alpha', 'beta'])
    })

    test('a search-style group over several columns', async () => {
      const rows = await Post.where(q => {
        for (const col of ['title']) q.orWhere(col, 'LIKE', '%a%')
      }).get()
      expect(titles(rows).sort()).toEqual(['alpha', 'beta', 'gamma'])
    })

    test('nested groups', async () => {
      const rows = await Post.where(q =>
        q.where('views', '>', 25).orWhere(q2 => q2.where('title', 'alpha').where('views', 10))
      ).get()
      expect(titles(rows).sort()).toEqual(['alpha', 'gamma'])
    })

    test('a group narrows rather than widens', async () => {
      const rows = await Post.where('views', '>', 15)
        .where(q => q.where('title', 'beta').orWhere('title', 'alpha')).get()
      expect(titles(rows)).toEqual(['beta'])
    })
  })

  describe('multiple HAVING is valid SQL', () => {
    test('both conditions apply', async () => {
      const rows = await Post.query().select('views').groupBy('views')
        .having('views', '>', 15).having('views', '<', 25).get()
      expect(rows.map(r => r.views)).toEqual([20])
    })
  })

  describe('Schema defaults are accepted by SQLite', () => {
    test('CREATE TABLE with a uuid column succeeds and generates a v4', async () => {
      await Schema.create('things', t => {
        t.uuid('uid')
        t.string('status').default('active')
        t.integer('n').default(5)
        t.boolean('ok').default(false)
        t.string('label')
      })

      db.exec(`INSERT INTO things (label) VALUES ('x')`)
      const row = db.prepare(`SELECT * FROM things`).get()

      expect(row.uid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(row.status).toBe('active')   // a literal, not a bare identifier
      expect(row.n).toBe(5)
      expect(row.ok).toBe(0)
    })

    test('uuid defaults differ per row', async () => {
      await Schema.create('ids', t => { t.uuid('uid'); t.integer('n') })
      db.exec(`INSERT INTO ids (n) VALUES (1), (2), (3)`)
      const uids = db.prepare(`SELECT uid FROM ids`).all().map(r => r.uid)
      expect(new Set(uids).size).toBe(3)
    })
  })
})
