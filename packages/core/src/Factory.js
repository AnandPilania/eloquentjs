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
 *   const users  = await UserFactory.new().count(10).create()
 *   const admin  = await UserFactory.new().state({ is_admin: true }).create()
 *   const made   = await UserFactory.new().make()      // not persisted
 */
export class Factory {
  // Subclasses define: static model = SomeModel
  /** @type {typeof import('./Model.js').Model | null} */
  static model = null

  static new() { return new this() }

  constructor() {
    this._count       = 1
    /** @type {((attrs: Record<string, any>) => Record<string, any>)[]} */
    this._states      = []
    this._afterMaking   = []
    this._afterCreating = []
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

  /** @param {Record<string, any>} overrides */
  _resolve(overrides = {}) {
    let attrs = this.definition()
    for (const stateFn of this._states) attrs = { ...attrs, ...stateFn(attrs) }
    return { ...attrs, ...overrides }
  }

  /** @param {Record<string, any>} overrides */
  async make(overrides = {}) {
    const ModelClass = /** @type {typeof import('./Model.js').Model} */ (/** @type {typeof Factory} */ (this.constructor).model)
    const makeOne = async () => {
      const m = new ModelClass()
      m.forceFill(this._resolve(overrides))
      for (const fn of this._afterMaking) await fn(m)
      return m
    }
    if (this._count === 1) return makeOne()
    return Promise.all(Array.from({ length: this._count }, makeOne))
  }

  /** @param {Record<string, any>} overrides */
  async create(overrides = {}) {
    const ModelClass = /** @type {typeof import('./Model.js').Model} */ (/** @type {typeof Factory} */ (this.constructor).model)
    const makeOne = async () => {
      const m = await ModelClass.create(this._resolve(overrides))
      for (const fn of this._afterCreating) await fn(m)
      return m
    }
    if (this._count === 1) return makeOne()
    return Promise.all(Array.from({ length: this._count }, makeOne))
  }

  /** @param {Record<string, any>[]} rows */
  async createMany(rows = []) {
    const ModelClass = /** @type {typeof import('./Model.js').Model} */ (/** @type {typeof Factory} */ (this.constructor).model)
    return Promise.all(rows.map(r => ModelClass.create(this._resolve(r))))
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
