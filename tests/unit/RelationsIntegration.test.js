/**
 * Integration tests for relations, transactions and relationship queries.
 *
 * These run real SQL against node:sqlite. The relations subsystem previously
 * had no test file at all, which is how the belongsToMany constraint no-op,
 * the sync() type mismatch and the `_pivot` attribute leak all shipped.
 *
 * node:sqlite landed in Node 22.5; the package floor is 20.6, so skip below it.
 */

import { SQLiteResolver } from '../../packages/sqlite/src/index.js'
import {
  Model, DB, setResolver, clearResolvers, ModelRegistry,
} from '../../packages/core/src/index.js'

let DatabaseSync
try {
  ({ DatabaseSync } = await import('node:sqlite'))
} catch {
  DatabaseSync = null
}

const describeIf = DatabaseSync ? describe : describe.skip

describeIf('Relations (real SQL)', () => {
  let db

  class User extends Model {
    static table = 'users'
    static fillable = ['name', 'country_id']
    static timestamps = false
    posts() { return this.hasMany(Post) }
    profile() { return this.hasOne(Profile) }
    roles() { return this.belongsToMany(Role, 'role_user', 'user_id', 'role_id') }
    country() { return this.belongsTo(Country) }
  }

  class Profile extends Model {
    static table = 'profiles'
    static fillable = ['user_id', 'bio']
    static timestamps = false
    user() { return this.belongsTo(User) }
  }

  class Post extends Model {
    static table = 'posts'
    static fillable = ['user_id', 'title', 'published']
    static timestamps = false
    author() { return this.belongsTo(User, 'user_id') }
    comments() { return this.morphMany(Comment, 'commentable') }
  }

  class Comment extends Model {
    static table = 'comments'
    static fillable = ['commentable_id', 'commentable_type', 'body']
    static timestamps = false
    commentable() { return this.morphTo('commentable') }
  }

  class Role extends Model {
    static table = 'roles'
    static fillable = ['name', 'active']
    static timestamps = false
  }

  class Country extends Model {
    static table = 'countries'
    static fillable = ['name']
    static timestamps = false
    posts() { return this.hasManyThrough(Post, User, 'country_id', 'user_id') }
  }

  const names = c => [...c].map(m => m.name)
  const titles = c => [...c].map(m => m.title)

  beforeEach(async () => {
    db = new DatabaseSync(':memory:')
    clearResolvers()
    setResolver(new SQLiteResolver(db))
    ModelRegistry.clear()
    ModelRegistry.morphMap({ post: Post })

    db.exec(`
      CREATE TABLE countries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, country_id INTEGER);
      CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bio TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, published INTEGER DEFAULT 0);
      CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, commentable_id INTEGER, commentable_type TEXT, body TEXT);
      CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
      CREATE TABLE role_user (user_id INTEGER, role_id INTEGER, expires_at TEXT, UNIQUE(user_id, role_id));
    `)
  })

  afterEach(() => { db?.close?.(); clearResolvers() })

  // ── hasMany / hasOne / belongsTo ───────────────────────────────────────────
  test('hasMany get() and eager load', async () => {
    const alice = await User.create({ name: 'Alice' })
    await alice.posts().create({ title: 'First' })
    await alice.posts().create({ title: 'Second' })
    await User.create({ name: 'Bob' })

    expect(titles(await alice.posts().get()).sort()).toEqual(['First', 'Second'])

    const users = await User.with('posts').orderBy('id').get()
    expect(titles(users[0].posts)).toHaveLength(2)
    expect([...users[1].posts]).toHaveLength(0)
  })

  test('relation is a builder: where/orderBy/limit reach the database', async () => {
    const alice = await User.create({ name: 'Alice' })
    await alice.posts().create({ title: 'Draft', published: 0 })
    await alice.posts().create({ title: 'Live', published: 1 })

    expect(titles(await alice.posts().where('published', 1).get())).toEqual(['Live'])
    expect(await alice.posts().where('published', 1).count()).toBe(1)
    expect(titles(await alice.posts().orderBy('title', 'desc').limit(1).get())).toEqual(['Live'])

    const page = await alice.posts().paginate(1, 1)
    expect(page.meta.total).toBe(2)
    expect(page.data).toHaveLength(1)
  })

  test('hasOne withDefault() returns an unsaved model instead of null', async () => {
    const alice = await User.create({ name: 'Alice' })
    const profile = await alice.profile().withDefault({ bio: 'none yet' })
    expect(profile.bio).toBe('none yet')
    expect(profile.isNew()).toBe(true)
  })

  test('belongsTo eager load skips null foreign keys', async () => {
    const uk = await Country.create({ name: 'UK' })
    await User.create({ name: 'Alice', country_id: uk.id })
    await User.create({ name: 'Bob' })

    const users = await User.with('country').orderBy('id').get()
    expect(users[0].country.name).toBe('UK')
    expect(users[1].country).toBeNull()
  })

  // ── belongsToMany ──────────────────────────────────────────────────────────
  test('belongsToMany constraints are applied, not collected and ignored', async () => {
    const alice = await User.create({ name: 'Alice' })
    const admin = await Role.create({ name: 'admin', active: 1 })
    const legacy = await Role.create({ name: 'legacy', active: 0 })
    await alice.roles().attach([admin.id, legacy.id])

    expect(names(await alice.roles().get()).sort()).toEqual(['admin', 'legacy'])
    // This returned ALL roles before the fix.
    expect(names(await alice.roles().where('active', 1).get())).toEqual(['admin'])
    expect(await alice.roles().where('active', 1).count()).toBe(1)
  })

  test('pivot data lands on a relation accessor, never the attribute bag', async () => {
    const alice = await User.create({ name: 'Alice' })
    const admin = await Role.create({ name: 'admin' })
    await alice.roles().withPivot('expires_at').attach(admin.id, { expires_at: '2030-01-01' })

    const [role] = await alice.roles().withPivot('expires_at').get()
    expect(role.pivot.expires_at).toBe('2030-01-01')
    // Would have been written back to the roles table on the next save().
    expect(role.getAttributes()).not.toHaveProperty('_pivot')
    expect(role.getAttributes()).not.toHaveProperty('_pivot_expires_at')
    expect(role.toJSON()).not.toHaveProperty('_pivot_foreign_id')
    expect(role.getDirty()).toEqual([])
  })

  test('sync() does not detach and reattach everything (numeric vs string keys)', async () => {
    const alice = await User.create({ name: 'Alice' })
    const a = await Role.create({ name: 'a' })
    const b = await Role.create({ name: 'b' })
    const c = await Role.create({ name: 'c' })
    await alice.roles().attach([a.id, b.id])

    // Object form yields string keys; DB values are numbers.
    const result = await alice.roles().sync({ [a.id]: {}, [c.id]: {} })
    expect(result.attached.map(Number)).toEqual([c.id])
    expect(result.detached.map(Number)).toEqual([b.id])
    expect(names(await alice.roles().get()).sort()).toEqual(['a', 'c'])
  })

  test('detach() with an array removes each row', async () => {
    const alice = await User.create({ name: 'Alice' })
    const a = await Role.create({ name: 'a' })
    const b = await Role.create({ name: 'b' })
    const c = await Role.create({ name: 'c' })
    await alice.roles().attach([a.id, b.id, c.id])

    await alice.roles().detach([a.id, b.id])
    expect(names(await alice.roles().get())).toEqual(['c'])
  })

  test('belongsToMany eager load groups by parent', async () => {
    const alice = await User.create({ name: 'Alice' })
    const bob = await User.create({ name: 'Bob' })
    const admin = await Role.create({ name: 'admin' })
    const editor = await Role.create({ name: 'editor' })
    await alice.roles().attach([admin.id, editor.id])
    await bob.roles().attach(editor.id)

    const users = await User.with('roles').orderBy('id').get()
    expect(names(users[0].roles).sort()).toEqual(['admin', 'editor'])
    expect(names(users[1].roles)).toEqual(['editor'])
  })

  // ── hasManyThrough ─────────────────────────────────────────────────────────
  test('hasManyThrough honours eager-load constraints', async () => {
    const uk = await Country.create({ name: 'UK' })
    const alice = await User.create({ name: 'Alice', country_id: uk.id })
    await alice.posts().create({ title: 'Draft', published: 0 })
    await alice.posts().create({ title: 'Live', published: 1 })

    expect(titles(await uk.posts().get()).sort()).toEqual(['Draft', 'Live'])

    const countries = await Country.with({ posts: qb => qb.where('published', 1) }).get()
    expect(titles(countries[0].posts)).toEqual(['Live'])
    expect(countries[0].posts[0].getAttributes()).not.toHaveProperty('_parent_id')
  })

  // ── polymorphic ────────────────────────────────────────────────────────────
  test('morphMany/morphTo use the morph map alias, not the class name', async () => {
    const alice = await User.create({ name: 'Alice' })
    const post = await alice.posts().create({ title: 'Hello' })
    await post.comments().create({ body: 'Nice' })

    const [comment] = await post.comments().get()
    expect(comment.commentable_type).toBe('post')   // aliased, not 'Post'

    const owner = await comment.commentable().get()
    expect(owner.title).toBe('Hello')
  })

  // ── relationship queries ───────────────────────────────────────────────────
  test('whereHas / whereDoesntHave', async () => {
    const alice = await User.create({ name: 'Alice' })
    await User.create({ name: 'Bob' })
    await alice.posts().create({ title: 'Live', published: 1 })

    expect(names(await User.whereHas('posts').get())).toEqual(['Alice'])
    expect(names(await User.whereDoesntHave('posts').get())).toEqual(['Bob'])
    expect(names(await User.whereHas('posts', qb => qb.where('published', 0)).get())).toEqual([])
  })

  test('withCount adds one aggregate query, not one per row', async () => {
    const alice = await User.create({ name: 'Alice' })
    const bob = await User.create({ name: 'Bob' })
    await alice.posts().create({ title: 'a' })
    await alice.posts().create({ title: 'b' })
    await bob.posts().create({ title: 'c' })

    const users = await User.withCount('posts').orderBy('id').get()
    expect(users[0].posts_count).toBe(2)
    expect(users[1].posts_count).toBe(1)
    expect(users[0].getDirty()).toEqual([])   // aggregates are not dirty columns
  })

  test('withCount reports 0 for parents with no children', async () => {
    await User.create({ name: 'Alice' })
    const users = await User.withCount('posts').get()
    expect(users[0].posts_count).toBe(0)
  })
})

describeIf('Transactions (real SQL)', () => {
  let db

  class Account extends Model {
    static table = 'accounts'
    static fillable = ['name', 'balance']
    static timestamps = false
  }

  beforeEach(() => {
    db = new DatabaseSync(':memory:')
    clearResolvers()
    setResolver(new SQLiteResolver(db))
    db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, balance INTEGER)')
  })

  afterEach(() => { db?.close?.(); clearResolvers() })

  test('model writes inside DB.transaction() are rolled back on throw', async () => {
    await expect(DB.transaction(async () => {
      await Account.create({ name: 'a', balance: 1 })
      await Account.create({ name: 'b', balance: 2 })
      throw new Error('boom')
    })).rejects.toThrow('boom')

    // The whole point: these used to be committed already.
    expect(await Account.count()).toBe(0)
  })

  test('a committed transaction persists every write', async () => {
    const result = await DB.transaction(async () => {
      const a = await Account.create({ name: 'a', balance: 1 })
      a.balance = 50
      await a.save()
      return a.id
    })

    expect(typeof result).toBe('number')
    expect(await Account.count()).toBe(1)
    expect((await Account.first()).balance).toBe(50)
  })

  test('DB.inTransaction() reflects the active scope', async () => {
    expect(DB.inTransaction()).toBe(false)
    await DB.transaction(async () => {
      expect(DB.inTransaction()).toBe(true)
    })
    expect(DB.inTransaction()).toBe(false)
  })

  test('a nested transaction rolls back to its savepoint only', async () => {
    await DB.transaction(async () => {
      await Account.create({ name: 'outer', balance: 1 })
      await expect(DB.transaction(async () => {
        await Account.create({ name: 'inner', balance: 2 })
        throw new Error('inner boom')
      })).rejects.toThrow('inner boom')
    })

    const names = [...(await Account.get())].map(a => a.name)
    expect(names).toEqual(['outer'])
  })

  test('DB.table() queries a bare table', async () => {
    await Account.create({ name: 'a', balance: 1 })
    expect(await DB.table('accounts').where('name', 'a').count()).toBe(1)
    expect(await DB.table('accounts').where('name', 'zz').count()).toBe(0)
  })
})
