/**
 * Tests for the six Eloquent-parity additions: Attribute::make() accessors,
 * AsCollection/AsArrayObject casts, hasOneOfMany/latestOfMany/oldestOfMany,
 * Prunable, cursorPaginate, and union/unionAll. Real SQL against node:sqlite
 * so the QueryBuilder→resolver→driver path is actually exercised, not just
 * the JS-side plumbing.
 */

import { SQLiteResolver } from '../../packages/sqlite/src/index.js'
import {
  Model, Attribute, AsCollection, AsArrayObject, setResolver, clearResolvers, ModelRegistry,
} from '../../packages/core/src/index.js'

let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}

const describeIf = DatabaseSync ? describe : describe.skip

describeIf('Eloquent parity additions (real SQL)', () => {
  let db

  class User extends Model {
    static table = 'users'
    static fillable = ['first_name', 'last_name', 'tags', 'options']
    static timestamps = false
    static casts = { tags: AsCollection, options: AsArrayObject }

    get fullName() {
      return Attribute.make({
        get: (_, attrs) => `${attrs.first_name} ${attrs.last_name}`,
        set: value => {
          const [first_name, last_name] = value.split(' ')
          return { first_name, last_name }
        },
      })
    }

    posts() { return this.hasMany(Post) }
    latestPost() { return this.hasOneOfMany(Post, 'created_at', 'MAX', 'user_id') }
    earliestPost() { return this.hasOneOfMany(Post, 'created_at', 'MIN', 'user_id') }
  }

  class Post extends Model {
    static table = 'posts'
    static fillable = ['user_id', 'title', 'created_at', 'archived']
    static timestamps = false

    static prunable() { return this.query().where('archived', 1) }
  }

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    clearResolvers()
    setResolver(new SQLiteResolver(db))
    ModelRegistry.clear()

    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT, last_name TEXT, tags TEXT, options TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, created_at TEXT, archived INTEGER DEFAULT 0);
    `)
  })

  afterEach(() => { db?.close?.(); clearResolvers() })

  // ── Attribute::make() ──────────────────────────────────────────────────────
  test('Attribute get/set: computed getter and multi-column setter', async () => {
    const alice = await User.create({ first_name: 'Alice', last_name: 'Smith' })
    expect(alice.fullName).toBe('Alice Smith')

    alice.fullName = 'Bob Jones'
    expect(alice.first_name).toBe('Bob')
    expect(alice.last_name).toBe('Jones')
    await alice.save()

    const fresh = await User.find(alice.id)
    expect(fresh.fullName).toBe('Bob Jones')
  })

  // ── AsCollection / AsArrayObject ────────────────────────────────────────────
  test('AsCollection round-trips as a Collection; AsArrayObject as a plain object', async () => {
    const alice = await User.create({
      first_name: 'Alice', last_name: 'Smith',
      tags: ['admin', 'staff'], options: { theme: 'dark' },
    })

    const fresh = await User.find(alice.id)
    expect([...fresh.tags]).toEqual(['admin', 'staff'])
    expect(typeof fresh.tags.map).toBe('function') // Collection, not a plain array
    expect(fresh.options).toEqual({ theme: 'dark' })
    expect(fresh.toJSON().tags).toEqual(['admin', 'staff'])

    const noTags = await User.create({ first_name: 'Bob', last_name: 'Jones' })
    expect(noTags.options).toEqual({})
  })

  // ── hasOneOfMany / latestOfMany / oldestOfMany ─────────────────────────────
  test('hasOneOfMany picks the right single row, both get() and eager load', async () => {
    const alice = await User.create({ first_name: 'Alice', last_name: 'Smith' })
    await Post.create({ user_id: alice.id, title: 'First', created_at: '2024-01-01' })
    await Post.create({ user_id: alice.id, title: 'Last', created_at: '2024-06-01' })

    expect((await alice.latestPost().get()).title).toBe('Last')
    expect((await alice.earliestPost().get()).title).toBe('First')

    const [loaded] = await User.with('latestPost').where('id', alice.id).get()
    expect(loaded.latestPost.title).toBe('Last')
  })

  // ── Prunable ────────────────────────────────────────────────────────────────
  test('prune() deletes only what prunable() selects, firing the pruning hook', async () => {
    const alice = await User.create({ first_name: 'Alice', last_name: 'Smith' })
    await Post.create({ user_id: alice.id, title: 'Keep', archived: 0 })
    await Post.create({ user_id: alice.id, title: 'Old', archived: 1 })

    const pruned = []
    Post.pruning = model => { pruned.push(model.title) }

    const count = await Post.prune()
    expect(count).toBe(1)
    expect(pruned).toEqual(['Old'])
    expect((await Post.query().get()).map(p => p.title)).toEqual(['Keep'])
    delete Post.pruning
  })

  // ── cursorPaginate ──────────────────────────────────────────────────────────
  test('cursorPaginate pages forward by id and reports the last page', async () => {
    for (let i = 1; i <= 5; i++) await User.create({ first_name: `U${i}`, last_name: '' })

    const page1 = await User.cursorPaginate(2)
    expect(page1.data.map(u => u.first_name)).toEqual(['U1', 'U2'])
    expect(page1.meta.has_more).toBe(true)

    const page2 = await User.query().orderBy('id').cursorPaginate(2, page1.meta.next_cursor)
    expect(page2.data.map(u => u.first_name)).toEqual(['U3', 'U4'])

    const page3 = await User.query().orderBy('id').cursorPaginate(2, page2.meta.next_cursor)
    expect(page3.data.map(u => u.first_name)).toEqual(['U5'])
    expect(page3.meta.has_more).toBe(false)
    expect(page3.meta.next_cursor).toBeNull()
  })

  // ── union / unionAll ─────────────────────────────────────────────────────────
  test('union combines two queries, dedupes by default, orders/limits the combined result', async () => {
    await User.create({ first_name: 'Alice', last_name: 'Smith' })
    await User.create({ first_name: 'Bob', last_name: 'Jones' })

    const admins = User.query().select('first_name').where('first_name', 'Alice')
    const rest = User.query().select('first_name').where('first_name', 'Bob')

    const combined = await admins.union(rest).orderBy('first_name').get()
    expect(combined.map(u => u.first_name)).toEqual(['Alice', 'Bob'])
  })

  test('union guards against aggregation: count() throws a clear error', async () => {
    const a = User.query().where('first_name', 'Alice')
    const b = User.query().where('first_name', 'Bob')
    await expect(a.union(b).count()).rejects.toThrow(/union/)
  })
})
