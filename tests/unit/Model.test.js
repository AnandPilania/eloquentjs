/**
 * Unit tests — Model (uses a mock resolver, no real DB needed)
 */

import { Model, withScopes } from '../../packages/core/src/Model.js'
import { setResolver, clearResolvers } from '../../packages/core/src/ConnectionRegistry.js'
import { HookRegistry }    from '../../packages/core/src/HookRegistry.js'
import { EventEmitter }    from '../../packages/core/src/EventEmitter.js'
import { Collection }      from '../../packages/core/src/Collection.js'

// ─── Mock Resolver ────────────────────────────────────────────────────────────
function makeMockResolver(rows = []) {
  const _rows = [...rows]
  const _inserted = []
  const _updated  = []
  const _deleted  = []

  return {
    _rows, _inserted, _updated, _deleted,

    async select(table, ctx) {
      // Simple WHERE id = N filtering for tests
      let result = [..._rows]
      for (const w of ctx?.wheres ?? []) {
        if (w.column === 'id' && w.operator === '=' && w.value !== undefined) {
          result = result.filter(r => r.id == w.value)
        }
      }
      return result
    },
    async insert(table, data) {
      const row = { id: _rows.length + 1, ...data }
      _rows.push(row)
      _inserted.push(row)
      return row
    },
    async update(table, conditions, data, ctx) {
      _updated.push({ table, conditions, data })
      // Apply to matching rows
      for (const row of _rows) {
        if (conditions && row[Object.keys(conditions)[0]] === Object.values(conditions)[0]) {
          Object.assign(row, data)
        }
      }
      return 1
    },
    async delete(table, conditions) {
      _deleted.push({ table, conditions })
      return 1
    },
    async aggregate(table, fn, col) {
      if (fn === 'count') return _rows.length
      return null
    },
    async increment() { return 1 },
    async truncate()  { _rows.length = 0 },
  }
}

// ─── Test Models ─────────────────────────────────────────────────────────────
class User extends Model {
  static table       = 'users'
  static fillable    = ['name', 'email', 'password', 'is_admin', 'meta']
  static hidden      = ['password']
  static timestamps  = false
  static casts       = {
    is_admin: 'boolean',
    meta:     'json',
    created_at: 'date',
  }
  static appends  = ['display_name']

  getDisplayNameAttribute() {
    return `${this.name} <${this.email}>`
  }

  setPasswordAttribute(v) {
    return `hashed:${v}`
  }

  static scopeActive(qb) { return qb.where('active', true) }
  static scopeAdmins(qb) { return qb.where('is_admin', true) }
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────
let mock

beforeEach(() => {
  mock = makeMockResolver([
    { id: 1, name: 'Alice', email: 'alice@test.com', password: 'hashed:secret', is_admin: true,  meta: '{"theme":"dark"}', created_at: '2024-01-01T00:00:00Z' },
    { id: 2, name: 'Bob',   email: 'bob@test.com',   password: 'hashed:pass',   is_admin: false, meta: null,             created_at: '2024-06-01T00:00:00Z' },
  ])
  clearResolvers()
  setResolver(mock)
  HookRegistry.flushAll()
  EventEmitter.flushAll()
})

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('Model.find / findOrFail', () => {
  test('find() returns hydrated model', async () => {
    const user = await User.find(1)
    expect(user).not.toBeNull()
    expect(user.name).toBe('Alice')
  })

  test('find() returns null for non-existent id', async () => {
    mock._rows.length = 0
    const user = await User.find(999)
    expect(user).toBeNull()
  })

  test('findOrFail() throws ModelNotFoundException', async () => {
    mock._rows.length = 0
    await expect(User.findOrFail(1)).rejects.toThrow('ModelNotFoundException' in Error ? Error : expect.any(Error))
  })
})

describe('Model attribute access', () => {
  test('reads raw attribute via property access', async () => {
    const user = await User.find(1)
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@test.com')
  })

  test('casts boolean correctly', async () => {
    const alice = await User.find(1)
    const bob   = await User.find(2)
    expect(alice.is_admin).toBe(true)
    expect(bob.is_admin).toBe(false)
  })

  test('casts json string to object', async () => {
    const user = await User.find(1)
    expect(user.meta).toEqual({ theme: 'dark' })
  })

  test('casts null json as null', async () => {
    const user = await User.find(2)
    expect(user.meta).toBeNull()
  })

  test('casts date string to Date', async () => {
    const user = await User.find(1)
    expect(user.created_at).toBeInstanceOf(Date)
    expect(user.created_at.getFullYear()).toBe(2024)
  })

  test('hidden fields excluded from toJSON()', async () => {
    const user = await User.find(1)
    const json = user.toJSON()
    expect(json).not.toHaveProperty('password')
  })

  test('appended virtual attributes appear in toJSON()', async () => {
    const user = await User.find(1)
    const json = user.toJSON()
    expect(json).toHaveProperty('display_name')
    expect(json.display_name).toBe('Alice <alice@test.com>')
  })
})

describe('Model mutators / accessors', () => {
  test('mutator transforms on setAttribute', () => {
    const user = new User()
    user.fill({ name: 'Test', email: 'x@x.com', password: 'secret123' })
    expect(user.getRawAttribute('password')).toBe('hashed:secret123')
  })

  test('accessor is called on getAttribute', async () => {
    const user = await User.find(1)
    expect(user.display_name).toBe('Alice <alice@test.com>')
  })
})

describe('Model mass assignment', () => {
  test('fill() respects fillable whitelist', () => {
    const user = new User()
    user.fill({ name: 'Test', id: 999, not_fillable: 'x' })
    expect(user.getRawAttribute('name')).toBe('Test')
    // id is not in fillable
    expect(user.getRawAttribute('id')).toBeUndefined()
    // not_fillable not in fillable
    expect(user.getRawAttribute('not_fillable')).toBeUndefined()
  })

  test('forceFill() bypasses guards', () => {
    const user = new User()
    user.forceFill({ id: 99, name: 'Forced' })
    expect(user.getRawAttribute('id')).toBe(99)
    expect(user.getRawAttribute('name')).toBe('Forced')
  })
})

describe('Model dirty tracking', () => {
  test('isDirty() after modification', async () => {
    const user = await User.find(1)
    expect(user.isDirty()).toBe(false)
    user.name = 'Changed'
    expect(user.isDirty()).toBe(true)
    expect(user.isDirty('name')).toBe(true)
    expect(user.isDirty('email')).toBe(false)
  })

  test('getDirty() returns changed keys', async () => {
    const user = await User.find(1)
    user.name  = 'X'
    user.email = 'x@x.com'
    expect(user.getDirty()).toEqual(expect.arrayContaining(['name', 'email']))
  })

  test('isClean() is inverse of isDirty()', async () => {
    const user = await User.find(1)
    expect(user.isClean()).toBe(true)
    user.name = 'Y'
    expect(user.isClean()).toBe(false)
    expect(user.isClean('email')).toBe(true)
  })

  test('getOriginal() returns unmodified values', async () => {
    const user = await User.find(1)
    user.name = 'Changed'
    expect(user.getOriginal('name')).toBe('Alice')
  })
})

describe('Model.create()', () => {
  test('creates and persists a new model', async () => {
    const user = await User.create({ name: 'Carol', email: 'carol@test.com', password: 'pw' })
    expect(user.id).toBeDefined()
    expect(mock._inserted).toHaveLength(1)
    expect(user.existsInDb()).toBe(true)
  })

  test('fires creating and created hooks', async () => {
    const order = []
    HookRegistry.register(User, 'creating', () => order.push('creating'))
    HookRegistry.register(User, 'created',  () => order.push('created'))
    await User.create({ name: 'Dave', email: 'd@test.com', password: 'pw' })
    expect(order).toEqual(['creating', 'created'])
  })

  test('static creating hook can mutate attributes', async () => {
    class SlugModel extends Model {
      static table    = 'slugs'
      static fillable = ['title', 'slug']
      static async creating(m) {
        m.forceFill({ slug: m.getRawAttribute('title').toLowerCase().replace(/ /g, '-') })
      }
    }

    const m = await SlugModel.create({ title: 'Hello World' })
    expect(m.getRawAttribute('slug')).toBe('hello-world')
  })
})

describe('Model.save() — update path', () => {
  test('saves dirty fields only', async () => {
    const user = await User.find(1)
    user.name = 'Updated'
    await user.save()

    expect(mock._updated).toHaveLength(1)
    expect(mock._updated[0].data).toHaveProperty('name', 'Updated')
    expect(mock._updated[0].data).not.toHaveProperty('email')
  })

  test('does not call update if nothing is dirty', async () => {
    const user = await User.find(1)
    await user.save()
    expect(mock._updated).toHaveLength(0)
  })

  test('fires updating and updated hooks', async () => {
    const order = []
    HookRegistry.register(User, 'updating', () => order.push('updating'))
    HookRegistry.register(User, 'updated',  () => order.push('updated'))
    const user = await User.find(1)
    user.name = 'Z'
    await user.save()
    expect(order).toEqual(['updating', 'updated'])
  })
})

describe('Model.delete() — hard delete', () => {
  test('deletes the record', async () => {
    const user = await User.find(1)
    await user.delete()
    expect(mock._deleted).toHaveLength(1)
    expect(user.existsInDb()).toBe(false)
  })

  test('fires deleting and deleted hooks', async () => {
    const order = []
    HookRegistry.register(User, 'deleting', () => order.push('deleting'))
    HookRegistry.register(User, 'deleted',  () => order.push('deleted'))
    const user = await User.find(1)
    await user.delete()
    expect(order).toEqual(['deleting', 'deleted'])
  })
})

describe('Model soft deletes', () => {
  class Post extends Model {
    static table       = 'posts'
    static fillable    = ['title', 'body', 'user_id', 'deleted_at']
    static softDeletes = true
    static timestamps  = false
  }

  beforeEach(() => {
    mock = makeMockResolver([
      { id: 1, title: 'Hello', body: 'World', user_id: 1, deleted_at: null },
      { id: 2, title: 'Gone',  body: 'Bye',   user_id: 1, deleted_at: '2024-01-01' },
    ])
    setResolver(mock)
  })

  test('delete() sets deleted_at instead of deleting row', async () => {
    const post = await Post.find(1)
    expect(post).not.toBeNull()
    await post.delete()
    expect(mock._deleted).toHaveLength(0)
    expect(mock._updated.some(u => u.data.deleted_at)).toBe(true)
    expect(post.isTrashed()).toBe(true)
  })

  test('_hydrate marks trashed when deleted_at is set', async () => {
    const post = Post._hydrate({ id: 2, title: 'Gone', deleted_at: '2024-01-01' })
    expect(post.isTrashed()).toBe(true)
  })

  test('restore() clears deleted_at', async () => {
    const post = Post._hydrate({ id: 2, title: 'Gone', deleted_at: '2024-01-01' })
    await post.restore()
    expect(mock._updated.some(u => u.data.deleted_at === null)).toBe(true)
    expect(post.isTrashed()).toBe(false)
  })
})

describe('Model.toJSON()', () => {
  test('returns plain object', async () => {
    const user = await User.find(1)
    const json = user.toJSON()
    expect(typeof json).toBe('object')
    expect(json.constructor).toBe(Object)
  })

  test('serializes loaded relations', async () => {
    const user = await User.find(1)
    const post = User._hydrate({ id: 10, title: 'My Post' })
    user.setRelation('posts', new Collection([post]))
    const json = user.toJSON()
    expect(json.posts).toHaveLength(1)
    expect(json.posts[0]).toMatchObject({ id: 10 })
  })

  test('visible filter restricts fields', () => {
    class SafeUser extends Model {
      static table   = 'users'
      static visible = ['id', 'name']
    }
    const u = SafeUser._hydrate({ id: 1, name: 'Alice', secret: 'shh' })
    const json = u.toJSON()
    expect(json).toHaveProperty('name')
    expect(json).not.toHaveProperty('secret')
  })
})

describe('Model EventEmitter integration', () => {
  test('Model:created event is emitted', async () => {
    let emitted = null
    EventEmitter.on('User:created', m => { emitted = m })
    await User.create({ name: 'Emit', email: 'e@e.com', password: 'pw' })
    expect(emitted).not.toBeNull()
    expect(emitted.name).toBe('Emit')
  })

  test('Observer registered via EventEmitter.observe()', async () => {
    const events = []
    EventEmitter.observe(User, {
      creating: () => events.push('creating'),
      created:  () => events.push('created'),
    })
    await User.create({ name: 'Obs', email: 'o@o.com', password: 'pw' })
    expect(events).toEqual(['creating', 'created'])
  })
})

describe('Model.updateOrCreate / firstOrCreate', () => {
  test('updateOrCreate: creates when not found', async () => {
    mock._rows.length = 0
    const m = await User.updateOrCreate({ email: 'new@test.com' }, { name: 'New' })
    expect(mock._inserted).toHaveLength(1)
    expect(m.email).toBe('new@test.com')
  })

  test('updateOrCreate: updates when found', async () => {
    const m = await User.updateOrCreate({ id: 1 }, { name: 'Updated' })
    // Should call update, not insert
    expect(mock._updated).toHaveLength(1)
  })

  test('firstOrCreate: returns existing', async () => {
    const m = await User.firstOrCreate({ email: 'alice@test.com' }, { name: 'Alice' })
    expect(m.name).toBe('Alice')
    expect(mock._inserted).toHaveLength(0)
  })

  test('firstOrCreate: creates if not found', async () => {
    mock._rows.length = 0
    const m = await User.firstOrCreate({ email: 'new@test.com' }, { name: 'New' })
    expect(mock._inserted).toHaveLength(1)
  })
})

describe('Model local scopes (via withScopes proxy)', () => {
  const ScopedUser = withScopes(User)

  test('scopeActive is callable as ScopedUser.active()', async () => {
    const qb = ScopedUser.active()
    expect(qb._wheres.some(w => w.column === 'active' && w.value === true)).toBe(true)
  })

  test('scopeAdmins is callable as ScopedUser.admins()', async () => {
    const qb = ScopedUser.admins()
    expect(qb._wheres.some(w => w.column === 'is_admin' && w.value === true)).toBe(true)
  })

  test('local scope result is a QueryBuilder that is further chainable', async () => {
    const qb = ScopedUser.active().orderBy('name').limit(10)
    expect(qb._wheres.some(w => w.column === 'active')).toBe(true)
    expect(qb._orderBys).toHaveLength(1)
    expect(qb._limit).toBe(10)
  })

  test('two separate scope calls each produce correct QBs', async () => {
    const qb1 = ScopedUser.active()
    const qb2 = ScopedUser.admins()
    expect(qb1._wheres[0].column).toBe('active')
    expect(qb2._wheres[0].column).toBe('is_admin')
  })
})
