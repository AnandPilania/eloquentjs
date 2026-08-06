/**
 * Unit tests — Factory and Schema/Blueprint.
 *
 * Neither had a test file. Schema was at 14% coverage, which is how the
 * `unsigned()` name collision, the no-op `.index()` and the Postgres
 * `gen_random_uuid()` leak into portable core all shipped.
 */

import { Blueprint, Schema, Expr, Factory, Model, setResolver, clearResolvers } from '../../packages/core/src/index.js'
import { Collection } from '../../packages/core/src/Collection.js'

// ─── Blueprint ────────────────────────────────────────────────────────────────

function blueprint(fn, mode = 'create') {
  const bp = new Blueprint('users', mode)
  fn(bp)
  return bp
}

describe('Blueprint columns', () => {
  test('unsignedInteger().unsigned() does not throw', () => {
    // `unsigned: true` in the column def used to overwrite the unsigned() method.
    const bp = blueprint(t => t.unsignedInteger('x').unsigned())
    expect(bp.columns[0]._unsigned).toBe(true)
    expect(typeof bp.columns[0].unsigned).toBe('function')
  })

  test('every def flag is _-prefixed, so no def key can clobber a modifier', () => {
    const bp = blueprint(t => t.string('name').nullable().default('x').comment('c').after('id'))
    const col = bp.columns[0]
    for (const method of ['nullable', 'default', 'unique', 'unsigned', 'index', 'change', 'useCurrent']) {
      expect(typeof col[method]).toBe('function')
    }
    expect(col._nullable).toBe(true)
    expect(col._default).toBe('x')
  })

  test('.index() registers a real index', () => {
    // Was `/* handled at table level */ return this` — a documented no-op.
    const bp = blueprint(t => t.string('email').index())
    expect(bp.indexes).toEqual([{ type: 'index', columns: ['email'], name: undefined }])
  })

  test('.unique() registers a named, droppable index', () => {
    const bp = blueprint(t => t.string('email').unique())
    expect(bp.indexes).toEqual([{ type: 'unique', columns: ['email'], name: undefined }])
  })

  test('uuid() emits a portable marker, not Postgres SQL', () => {
    // Core must not know about gen_random_uuid(); each driver renders the marker.
    const bp = blueprint(t => t.uuid())
    expect(bp.columns[0]._default).toEqual(Expr.uuid)
    expect(JSON.stringify(bp.columns[0]._default)).not.toContain('gen_random_uuid')
  })

  test('useCurrent() emits the now marker', () => {
    const bp = blueprint(t => t.timestamp('seen_at').useCurrent())
    expect(bp.columns[0]._default).toEqual(Expr.now)
  })

  test('longText/mediumText/tinyText are distinct types', () => {
    // All three used to collapse to plain `text`.
    const bp = blueprint(t => { t.tinyText('a'); t.text('b'); t.mediumText('c'); t.longText('d') })
    expect(bp.columns.map(c => c.type)).toEqual(['tinyText', 'text', 'mediumText', 'longText'])
  })

  test('.change() moves the column to changes, not columns', () => {
    const bp = blueprint(t => t.string('name', 500).change(), 'alter')
    expect(bp.columns).toHaveLength(0)
    expect(bp.changes).toHaveLength(1)
    expect(bp.changes[0]).toMatchObject({ name: 'name', type: 'string', length: 500 })
  })
})

describe('Blueprint foreign keys', () => {
  test('cascadeOnDelete() before constrained() is honoured', () => {
    // The action used to be looked up on a constraint that did not exist yet.
    const bp = blueprint(t => t.foreignId('role_id').cascadeOnDelete().constrained('roles'))
    expect(bp.foreigns[0]).toMatchObject({ column: 'role_id', table: 'roles', onDelete: 'CASCADE' })
  })

  test('cascadeOnDelete() after constrained() still works', () => {
    const bp = blueprint(t => t.foreignId('role_id').constrained('roles').cascadeOnDelete())
    expect(bp.foreigns[0].onDelete).toBe('CASCADE')
  })

  test('nullOnDelete() and the update actions', () => {
    const bp = blueprint(t => t.foreignId('a').nullOnDelete().restrictOnUpdate().constrained('bs'))
    expect(bp.foreigns[0]).toMatchObject({ onDelete: 'SET NULL', onUpdate: 'RESTRICT' })
  })

  test('references().on() is an alternative to constrained()', () => {
    const bp = blueprint(t => t.foreignId('role_id').references('uuid').on('roles'))
    expect(bp.foreigns[0]).toMatchObject({ column: 'role_id', table: 'roles', references: 'uuid' })
  })

  test('the standalone foreign() chain works without `this` capture', () => {
    const bp = blueprint(t => t.foreign('role_id').references('id').on('roles').cascadeOnDelete())
    expect(bp.foreigns[0]).toMatchObject({ column: 'role_id', table: 'roles', onDelete: 'CASCADE' })
  })

  test('morphs() adds both columns and a compound index', () => {
    const bp = blueprint(t => t.morphs('imageable'))
    expect(bp.columns.map(c => c.name)).toEqual(['imageable_type', 'imageable_id'])
    expect(bp.indexes[0].columns).toEqual(['imageable_type', 'imageable_id'])
  })
})

describe('Schema drop options', () => {
  const calls = []
  const resolver = {
    async select() { return [] },
    async insert(t, d) { return d },
    async update() { return 0 },
    async delete() { return 0 },
    async truncate(table, opts) { calls.push(['truncate', table, opts]) },
    async dropTable(table, opts) { calls.push(['dropTable', table, opts]) },
    async createTable(table, bp) { calls.push(['createTable', table, bp]) },
  }

  beforeEach(() => { calls.length = 0; clearResolvers(); setResolver(resolver) })
  afterEach(() => clearResolvers())

  test('drop() does not cascade by default', async () => {
    await Schema.drop('users')
    expect(calls[0]).toEqual(['dropTable', 'users', {}])
  })

  test('cascade is opt-in', async () => {
    await Schema.dropIfExists('users', { cascade: true })
    expect(calls[0][2]).toEqual({ cascade: true, ifExists: true })
  })

  test('a string second argument is still read as the connection name', async () => {
    // Backwards compatibility with Schema.dropIfExists(table, 'conn').
    setResolver(resolver, 'other')
    await Schema.dropIfExists('users', 'other')
    expect(calls[0][2]).toEqual({ ifExists: true })
  })
})

// ─── Factory ──────────────────────────────────────────────────────────────────

describe('Factory', () => {
  const inserted = []

  class Widget extends Model {
    static table = 'widgets'
    static timestamps = false
    // No `fillable`: with guarded defaulting to ['*'] a factory that went
    // through mass assignment would write nothing at all.
  }

  class WidgetFactory extends Factory {
    static model = Widget
    definition() { return { name: 'widget', size: 1 } }
    large() { return this.state({ size: 100 }) }
  }

  /** The old stub form — an instance field rather than a static. */
  class LegacyFactory extends Factory {
    model = Widget
    definition() { return { name: 'legacy' } }
  }

  beforeEach(() => {
    inserted.length = 0
    clearResolvers()
    setResolver({
      async select() { return [] },
      async insert(table, data) { inserted.push(data); return { ...data, id: inserted.length } },
      async update() { return 1 },
      async delete() { return 1 },
      async truncate() { },
    })
  })
  afterEach(() => clearResolvers())

  test('create() writes the definition even with no fillable declared', async () => {
    const w = await WidgetFactory.new().create()
    expect(w.name).toBe('widget')
    expect(inserted[0]).toMatchObject({ name: 'widget', size: 1 })
  })

  test('count() > 1 returns a Collection, not a plain Array', async () => {
    const many = await WidgetFactory.new().count(3).create()
    expect(many).toBeInstanceOf(Collection)
    expect(many).toHaveLength(3)
  })

  test('make() does not persist', async () => {
    const w = await WidgetFactory.new().make()
    expect(w.isNew()).toBe(true)
    expect(inserted).toHaveLength(0)
  })

  test('states and overrides layer in order', async () => {
    const w = await WidgetFactory.new().large().create({ name: 'custom' })
    expect(w.size).toBe(100)
    expect(w.name).toBe('custom')
  })

  test('sequence() cycles across rows', async () => {
    await WidgetFactory.new().count(4).sequence({ size: 10 }, { size: 20 }).create()
    expect(inserted.map(r => r.size)).toEqual([10, 20, 10, 20])
  })

  test('raw() returns attributes without a model', () => {
    expect(WidgetFactory.new().raw()).toEqual({ name: 'widget', size: 1 })
    expect(WidgetFactory.new().count(2).raw()).toHaveLength(2)
  })

  test('createMany() runs one row per entry and returns a Collection', async () => {
    const out = await WidgetFactory.new().createMany([{ name: 'a' }, { name: 'b' }])
    expect(out).toBeInstanceOf(Collection)
    expect(inserted.map(r => r.name)).toEqual(['a', 'b'])
  })

  test('afterMaking / afterCreating hooks run', async () => {
    const seen = []
    await WidgetFactory.new()
      .afterMaking(() => seen.push('making'))
      .make()
    await WidgetFactory.new()
      .afterCreating(() => seen.push('creating'))
      .create()
    expect(seen).toEqual(['making', 'creating'])
  })

  test('an instance `model` field works as well as the static', async () => {
    const w = await LegacyFactory.new().create()
    expect(w.name).toBe('legacy')
  })

  test('a factory with no model at all reports it clearly', async () => {
    class Broken extends Factory { definition() { return {} } }
    await expect(Broken.new().create()).rejects.toThrow(/must set `static model/)
  })
})
