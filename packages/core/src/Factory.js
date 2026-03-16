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
  static model = null

  static new() { return new this() }

  constructor() {
    this._count       = 1
    this._states      = []
    this._afterMaking   = []
    this._afterCreating = []
  }

  /** Override to return default attribute map. */
  definition() {
    throw new Error(`${this.constructor.name}.definition() must be implemented`)
  }

  count(n)          { this._count = n; return this }
  times(n)          { return this.count(n) }

  state(overrides) {
    this._states.push(typeof overrides === 'function' ? overrides : () => overrides)
    return this
  }

  afterMaking(fn)   { this._afterMaking.push(fn);   return this }
  afterCreating(fn) { this._afterCreating.push(fn); return this }

  _resolve(overrides = {}) {
    let attrs = this.definition()
    for (const stateFn of this._states) attrs = { ...attrs, ...stateFn(attrs) }
    return { ...attrs, ...overrides }
  }

  async make(overrides = {}) {
    const ModelClass = this.constructor.model
    const makeOne = async () => {
      const m = new ModelClass()
      m.forceFill(this._resolve(overrides))
      for (const fn of this._afterMaking) await fn(m)
      return m
    }
    if (this._count === 1) return makeOne()
    return Promise.all(Array.from({ length: this._count }, makeOne))
  }

  async create(overrides = {}) {
    const ModelClass = this.constructor.model
    const makeOne = async () => {
      const m = await ModelClass.create(this._resolve(overrides))
      for (const fn of this._afterCreating) await fn(m)
      return m
    }
    if (this._count === 1) return makeOne()
    return Promise.all(Array.from({ length: this._count }, makeOne))
  }

  async createMany(rows = []) {
    return Promise.all(rows.map(r => this.constructor.model.create(this._resolve(r))))
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
