/**
 * @eloquentjs/core — Factory
 *
 *   class UserFactory extends Factory {
 *     static model = User
 *     definition() {
 *       return {
 *         name:  faker.person.fullName(),
 *         email: faker.internet.email(),
 *       }
 *     }
 *   }
 *
 *   const user   = await UserFactory.new().create()
 *   const users  = await UserFactory.new().count(10).create()   // Collection
 *   const admin  = await UserFactory.new().state({ is_admin: true }).create()
 *   const made   = await UserFactory.new().make()      // not persisted
 *   const attrs  = UserFactory.new().raw()             // just the attributes
 *
 *   // Cycle through values per row
 *   await UserFactory.new().count(3).sequence({ role: 'admin' }, { role: 'editor' }).create()
 *
 *   // Relations
 *   await UserFactory.new().has(PostFactory.new().count(3), 'posts').create()
 *   await PostFactory.new().for(user, 'author').create()
 *
 * Factories bypass fillable/guarded: seed data is trusted, and `guarded`
 * defaults to `['*']`, so going through mass assignment would silently drop
 * every attribute unless the model declared `fillable`.
 */
import { Collection } from './Collection.js'

export class Factory {
  // Subclasses define: static model = SomeModel (an instance field also works)
  /** @type {typeof import('./Model.js').Model | null} */
  static model = null

  /** @type {typeof import('./Model.js').Model | undefined} */
  model = undefined

  static new() { return new this() }

  constructor() {
    this._count       = 1
    /** @type {((attrs: Record<string, any>) => Record<string, any>)[]} */
    this._states      = []
    this._afterMaking   = []
    this._afterCreating = []
    /** @type {Record<string, any>[]} */
    this._sequence    = []
    this._index       = 0
    /** @type {{factory: Factory, relation: string}[]} */
    this._has         = []
    /** @type {{model: any, relation: string}[]} */
    this._for         = []
    /** @type {Map<Function, any>} */
    this._recycled    = new Map()
  }

  /**
   * Override to return default attribute map.
   * @returns {Record<string, any>}
   */
  definition() {
    throw new Error(`${this.constructor.name}.definition() must be implemented`)
  }

  count(n)          { this._count = n; return this }
  times(n)          { return this.count(n) }

  /** @param {Record<string, any> | ((attrs: Record<string, any>) => Record<string, any>)} overrides */
  state(overrides) {
    const stateFn = typeof overrides === 'function'
      ? /** @type {(attrs: Record<string, any>) => Record<string, any>} */ (overrides)
      : () => overrides
    this._states.push(stateFn)
    return this
  }

  afterMaking(fn)   { this._afterMaking.push(fn);   return this }
  afterCreating(fn) { this._afterCreating.push(fn); return this }

  /**
   * Cycle attribute sets across the generated rows.
   *   .count(4).sequence({ role: 'admin' }, { role: 'editor' })
   * yields admin, editor, admin, editor.
   * @param {...Record<string, any>} sets
   */
  sequence(...sets) {
    this._sequence.push(...sets.flat())
    return this
  }

  /**
   * Also create related records through `relation` on each generated model.
   * @param {Factory} factory
   * @param {string} relation the relation method name on the parent
   */
  has(factory, relation) {
    this._has.push({ factory, relation })
    return this
  }

  /**
   * Attach each generated model to an existing parent through `relation`
   * (a belongsTo on this model).
   * @param {any} model
   * @param {string} relation
   */
  for(model, relation) {
    this._for.push({ model, relation })
    return this
  }

  /**
   * Reuse one instance for every reference to its model, instead of creating a
   * fresh row per row — Laravel's recycle().
   * @param {...any} models
   */
  recycle(...models) {
    for (const model of models.flat()) this._recycled.set(model.constructor, model)
    return this
  }

  /** The recycled instance for a model class, if any. */
  recycled(ModelClass) { return this._recycled.get(ModelClass) }

  /** @param {Record<string, any>} overrides */
  _resolve(overrides = {}) {
    let attrs = this.definition()
    for (const stateFn of this._states) attrs = { ...attrs, ...stateFn(attrs) }
    if (this._sequence.length) {
      attrs = { ...attrs, ...this._sequence[this._index % this._sequence.length] }
    }
    this._index++
    return { ...attrs, ...overrides }
  }

  /** The resolved attributes, without building a model — Laravel's raw(). */
  raw(overrides = {}) {
    if (this._count === 1) return this._resolve(overrides)
    return Array.from({ length: this._count }, () => this._resolve(overrides))
  }

  get _model() {
    // `static model = User` is the documented form, but an instance field
    // (`model = User`) reads naturally and is what the generated stub used to
    // emit — accept both rather than failing with "definition() undefined".
    const ModelClass = this.model ?? /** @type {typeof Factory} */ (this.constructor).model
    if (!ModelClass) {
      throw new Error(`${this.constructor.name} must set \`static model = SomeModel\``)
    }
    return /** @type {typeof import('./Model.js').Model} */ (ModelClass)
  }

  /** Attributes that link a generated row to its `for()` parents. */
  _forAttributes() {
    const out = {}
    for (const { model, relation } of this._for) {
      const probe = new this._model()
      const rel = typeof probe[relation] === 'function' ? probe[relation]() : null
      const keys = rel?.correlationKeys?.()
      // On a belongsTo, foreignKey is the owner key and localKey the FK column.
      if (keys) out[keys.localKey] = model.getAttribute(keys.foreignKey)
    }
    return out
  }

  /**
   * @param {Record<string, any>} overrides
   * @returns {Promise<any>} one model, or a Collection when count > 1
   */
  async make(overrides = {}) {
    const ModelClass = this._model
    const makeOne = async () => {
      const m = new ModelClass()
      m.forceFill({ ...this._resolve(overrides), ...this._forAttributes() })
      for (const fn of this._afterMaking) await fn(m)
      return m
    }
    if (this._count === 1) return makeOne()
    // A Collection, not a plain Array, so the result behaves like a query result.
    return new Collection(await Promise.all(Array.from({ length: this._count }, makeOne)))
  }

  /**
   * @param {Record<string, any>} overrides
   * @returns {Promise<any>} one model, or a Collection when count > 1
   */
  async create(overrides = {}) {
    const createOne = async () => {
      const m = new this._model()
      // forceFill, not create(): factory data is trusted, and going through
      // mass assignment would drop everything for a model without `fillable`.
      m.forceFill({ ...this._resolve(overrides), ...this._forAttributes() })
      await m.save()
      for (const { factory, relation } of this._has) {
        const rel = m[relation]()
        const children = [await factory.make()].flat()
        for (const child of children) await rel.save(child)
      }
      for (const fn of this._afterCreating) await fn(m)
      return m
    }
    if (this._count === 1) return createOne()
    return new Collection(await Promise.all(Array.from({ length: this._count }, createOne)))
  }

  /** create() without firing model events. */
  async createQuietly(overrides = {}) {
    const { HookRegistry } = await import('./HookRegistry.js')
    const ModelClass = this._model
    const saved = new Map()
    for (const event of ['saving', 'creating', 'created', 'saved']) {
      if (Object.prototype.hasOwnProperty.call(ModelClass, event)) {
        saved.set(event, ModelClass[event])
        ModelClass[event] = undefined
      }
    }
    HookRegistry.flush(ModelClass)
    try {
      return await this.create(overrides)
    } finally {
      for (const [event, fn] of saved) ModelClass[event] = fn
    }
  }

  /**
   * One model per row of `rows`. Each row is merged over the definition.
   * @param {Record<string, any>[]} rows
   * @returns {Promise<Collection>}
   */
  async createMany(rows = []) {
    const created = []
    for (const row of rows) {
      const m = new this._model()
      m.forceFill({ ...this._resolve(row), ...this._forAttributes() })
      await m.save()
      for (const fn of this._afterCreating) await fn(m)
      created.push(m)
    }
    return new Collection(created)
  }
}

/**
 * @eloquentjs/core — Seeder
 *
 *   class DatabaseSeeder extends Seeder {
 *     async run() {
 *       await this.call(UserSeeder, PostSeeder)
 *     }
 *   }
 */
export class Seeder {
  async run() {
    throw new Error(`${this.constructor.name}.run() must be implemented`)
  }

  async call(...Seeders) {
    for (const S of Seeders.flat()) {
      const seeder = typeof S === 'function' ? new S() : S
      await seeder.run()
    }
  }
}
