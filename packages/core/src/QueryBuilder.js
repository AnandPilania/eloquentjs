/**
 * @eloquentjs/core — QueryBuilder
 *
 * Fluent query builder. Every method returns `this` for chaining.
 * Implements a then() so the builder itself is awaitable.
 *
 *   const users = await User.where('active', true)
 *                            .with('profile')
 *                            .orderBy('name')
 *                            .paginate(1, 20)
 */

import { Collection } from './Collection.js'
import { ModelNotFoundException } from './errors.js'

export class QueryBuilder {
  constructor(ModelClass, resolver) {
    this._model    = ModelClass
    this._resolver = resolver
    this._wheres    = []
    this._rawWheres = []
    this._selects   = ['*']
    this._joins     = []
    this._orderBys  = []
    this._groupBys  = []
    this._havings   = []
    this._limit     = null
    this._offset    = null
    this._withs     = []
    this._distinct  = false
    this._globalScopes  = {}   // name -> scope fn (for withoutGlobalScope)
  }

  // ─── WHERE ───────────────────────────────────────────────────────────────────
  where(column, operator, value) {
    // where({ key: val, ... }) object shorthand
    if (column !== null && typeof column === 'object' && !Array.isArray(column)) {
      for (const [k, v] of Object.entries(column)) {
        this._wheres.push({ column: k, operator: '=', value: v, boolean: 'and' })
      }
      return this
    }
    // where('col', val)  — two-arg shorthand for equality
    if (value === undefined) { value = operator; operator = '=' }
    this._wheres.push({ column, operator: operator.toUpperCase(), value, boolean: 'and' })
    return this
  }

  orWhere(column, operator, value) {
    if (value === undefined) { value = operator; operator = '=' }
    this._wheres.push({ column, operator: operator.toUpperCase(), value, boolean: 'or' })
    return this
  }

  whereNot(column, value)          { return this.where(column, '!=', value) }
  whereIn(column, values)          { this._wheres.push({ type: 'in',      column, values, boolean: 'and' }); return this }
  whereNotIn(column, values)       { this._wheres.push({ type: 'notIn',   column, values, boolean: 'and' }); return this }
  whereNull(column)                { this._wheres.push({ type: 'null',    column,         boolean: 'and' }); return this }
  whereNotNull(column)             { this._wheres.push({ type: 'notNull', column,         boolean: 'and' }); return this }
  whereBetween(column, [min, max]) { this._wheres.push({ type: 'between', column, min, max, boolean: 'and' }); return this }
  whereNotBetween(col, [min, max]) { this._wheres.push({ type: 'notBetween', column: col, min, max, boolean: 'and' }); return this }
  whereLike(column, pattern)       { return this.where(column, 'LIKE', pattern) }
  whereNotLike(column, pattern)    { return this.where(column, 'NOT LIKE', pattern) }

  whereDate(column, operator, value) {
    if (value === undefined) { value = operator; operator = '=' }
    this._wheres.push({ type: 'date', column, operator, value, boolean: 'and' })
    return this
  }
  whereYear(column, year) {
    this._wheres.push({ type: 'year', column, value: year, boolean: 'and' })
    return this
  }
  whereMonth(column, month) {
    this._wheres.push({ type: 'month', column, value: month, boolean: 'and' })
    return this
  }
  whereDay(column, day) {
    this._wheres.push({ type: 'day', column, value: day, boolean: 'and' })
    return this
  }
  whereJsonContains(column, value) {
    this._wheres.push({ type: 'jsonContains', column, value, boolean: 'and' })
    return this
  }
  whereRaw(sql, bindings = []) {
    this._rawWheres.push({ sql, bindings })
    return this
  }

  // ─── SELECT ──────────────────────────────────────────────────────────────────
  select(...columns)  { this._selects = columns.flat(); return this }
  addSelect(...cols)  { this._selects = [...this._selects.filter(c => c !== '*'), ...cols.flat()]; return this }
  selectRaw(expr)     { this._selects = [{ raw: expr }]; return this }
  distinct()          { this._distinct = true; return this }

  // ─── JOINS ───────────────────────────────────────────────────────────────────
  join(table, first, operator, second)      { this._joins.push({ type: 'INNER', table, first, operator, second }); return this }
  leftJoin(table, first, operator, second)  { this._joins.push({ type: 'LEFT',  table, first, operator, second }); return this }
  rightJoin(table, first, operator, second) { this._joins.push({ type: 'RIGHT', table, first, operator, second }); return this }
  crossJoin(table)                          { this._joins.push({ type: 'CROSS', table }); return this }

  // ─── ORDER / GROUP / HAVING ───────────────────────────────────────────────────
  orderBy(column, direction = 'asc') {
    this._orderBys.push({ column, direction: direction.toLowerCase() === 'desc' ? 'DESC' : 'ASC' })
    return this
  }
  orderByDesc(column)     { return this.orderBy(column, 'desc') }
  orderByRaw(expression)  { this._orderBys.push({ raw: expression }); return this }
  inRandomOrder()         { this._orderBys.push({ random: true }); return this }
  latest(col)             { return this.orderBy(col ?? this._model.createdAtColumn, 'desc') }
  oldest(col)             { return this.orderBy(col ?? this._model.createdAtColumn, 'asc') }

  groupBy(...columns) { this._groupBys.push(...columns.flat()); return this }

  having(column, operator, value) {
    if (value === undefined) { value = operator; operator = '=' }
    this._havings.push({ column, operator, value })
    return this
  }

  // ─── LIMIT / OFFSET ──────────────────────────────────────────────────────────
  limit(n)            { this._limit  = n; return this }
  take(n)             { return this.limit(n) }
  offset(n)           { this._offset = n; return this }
  skip(n)             { return this.offset(n) }
  forPage(page, per)  { return this.offset((page - 1) * per).limit(per) }

  // ─── SOFT DELETES ────────────────────────────────────────────────────────────
  withTrashed() {
    // Remove the auto-applied whereNull(deletedAtColumn) from query()
    this._removeDeletedAtScope()
    return this
  }

  onlyTrashed() {
    this._removeDeletedAtScope()
    this._wheres.push({ type: 'notNull', column: this._model.deletedAtColumn, boolean: 'and' })
    return this
  }

  _removeDeletedAtScope() {
    const col = this._model.deletedAtColumn
    this._wheres = this._wheres.filter(w =>
      !(w.type === 'null' && w.column === col)
    )
  }

  // ─── GLOBAL SCOPES ───────────────────────────────────────────────────────────
  withoutGlobalScope(name) {
    if (this._globalScopes[name]) {
      // Remove wheres that have this scope tag
      this._wheres = this._wheres.filter(w => w._scope !== name)
      delete this._globalScopes[name]
    }
    return this
  }

  // ─── EAGER LOADING ───────────────────────────────────────────────────────────
  with(...relations) {
    for (const rel of relations.flat()) {
      if (typeof rel === 'string') {
        this._withs.push({ name: rel, constraints: null })
      } else if (rel && typeof rel === 'object') {
        for (const [name, fn] of Object.entries(rel)) {
          this._withs.push({ name, constraints: fn })
        }
      }
    }
    return this
  }

  // ─── AGGREGATES ──────────────────────────────────────────────────────────────
  async count(column = '*') {
    return this._resolver.aggregate(this._model.getTable(), 'count', column, this._buildContext())
  }
  async max(column) {
    return this._resolver.aggregate(this._model.getTable(), 'max', column, this._buildContext())
  }
  async min(column) {
    return this._resolver.aggregate(this._model.getTable(), 'min', column, this._buildContext())
  }
  async sum(column) {
    return this._resolver.aggregate(this._model.getTable(), 'sum', column, this._buildContext())
  }
  async avg(column) {
    return this._resolver.aggregate(this._model.getTable(), 'avg', column, this._buildContext())
  }
  async exists()     { return (await this.count()) > 0 }
  async doesntExist(){ return !(await this.exists()) }

  // ─── EXECUTION ───────────────────────────────────────────────────────────────
  async get() {
    const rows = await this._resolver.select(this._model.getTable(), this._buildContext())
    const models = rows.map(row => this._model._hydrate(row))
    if (this._withs.length > 0) await this._eagerLoad(models)
    return new Collection(models)
  }

  async first() {
    // Clone limit to avoid mutating shared builder state when used in paginate etc.
    const ctx = { ...this._buildContext(), limit: 1 }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    if (!rows.length) return null
    const model = this._model._hydrate(rows[0])
    if (this._withs.length > 0) await this._eagerLoad([model])
    return model
  }

  async firstOrFail() {
    const m = await this.first()
    if (!m) throw new ModelNotFoundException(`No ${this._model.name} record found`)
    return m
  }

  async find(id) {
    return this.where(this._model.primaryKey, id).first()
  }

  async pluck(column, keyBy = null) {
    const ctx = { ...this._buildContext(), selects: keyBy ? [column, keyBy] : [column] }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    if (keyBy) return Object.fromEntries(rows.map(r => [r[keyBy], r[column]]))
    return rows.map(r => r[column])
  }

  async value(column) {
    const ctx = { ...this._buildContext(), selects: [column], limit: 1 }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    return rows[0]?.[column] ?? null
  }

  async chunk(size, callback) {
    let page = 1
    while (true) {
      // Build a fresh context per page to avoid mutating state
      const ctx = { ...this._buildContext(), limit: size, offset: (page - 1) * size }
      const rows = await this._resolver.select(this._model.getTable(), ctx)
      if (!rows.length) break
      const models = new Collection(rows.map(r => this._model._hydrate(r)))
      const cont = await callback(models, page)
      if (cont === false || rows.length < size) break
      page++
    }
  }

  async paginate(page = 1, perPage = 15) {
    // Run count on a clean copy of context (no limit/offset/orderBy)
    const countCtx = {
      ...this._buildContext(),
      selects: ['*'],
      orderBys: [],
      limit: null,
      offset: null,
    }
    const total = await this._resolver.aggregate(
      this._model.getTable(), 'count', '*', countCtx
    )

    const dataCtx = { ...this._buildContext(), limit: perPage, offset: (page - 1) * perPage }
    const rows = await this._resolver.select(this._model.getTable(), dataCtx)
    const models = rows.map(r => this._model._hydrate(r))
    if (this._withs.length > 0) await this._eagerLoad(models)

    const lastPage = total === 0 ? 1 : Math.ceil(total / perPage)
    return {
      data: new Collection(models),
      meta: {
        total,
        per_page:     perPage,
        current_page: page,
        last_page:    lastPage,
        from:         total === 0 ? null : (page - 1) * perPage + 1,
        to:           total === 0 ? null : Math.min(page * perPage, total),
        has_more:     page < lastPage,
      },
    }
  }

  // ─── WRITES (bulk) ────────────────────────────────────────────────────────────
  async update(attributes) {
    return this._resolver.update(
      this._model.getTable(), null, attributes, this._buildContext()
    )
  }

  async delete() {
    if (this._model.softDeletes) {
      return this.update({ [this._model.deletedAtColumn]: new Date() })
    }
    return this._resolver.delete(this._model.getTable(), null, this._buildContext())
  }

  async forceDelete() {
    return this._resolver.delete(this._model.getTable(), null, this._buildContext())
  }

  async increment(column, amount = 1, extra = {}) {
    return this._resolver.increment(
      this._model.getTable(), column, amount, extra, this._buildContext()
    )
  }

  async decrement(column, amount = 1, extra = {}) {
    return this.increment(column, -Math.abs(amount), extra)
  }

  // ─── DEBUG ────────────────────────────────────────────────────────────────────
  async toSQL() {
    return this._resolver.toSQL(this._model.getTable(), this._buildContext())
  }

  dd() {
    this.toSQL().then(({ sql, params }) => {
      console.log('[EloquentJS SQL]', sql)
      console.log('[EloquentJS PARAMS]', params)
    })
    return this
  }

  // ─── EAGER LOADING ───────────────────────────────────────────────────────────
  async _eagerLoad(models) {
    if (!models.length) return

    for (const { name: fullName, constraints } of this._withs) {
      // Support nested: 'posts.comments.author' → load 'posts' first, pass 'comments.author' down
      const dotIdx   = fullName.indexOf('.')
      const relName  = dotIdx === -1 ? fullName : fullName.slice(0, dotIdx)
      const nested   = dotIdx === -1 ? null : fullName.slice(dotIdx + 1)

      // Get relation from first model (all models in batch are same class)
      const firstModel = models[0]
      const relMethod  = firstModel[relName]
      if (typeof relMethod !== 'function') continue

      const relation = relMethod.call(firstModel)
      if (!relation?.eagerLoad) continue

      await relation.eagerLoad(models, relName, constraints, nested)
    }
  }

  // ─── BUILD CONTEXT ───────────────────────────────────────────────────────────
  _buildContext() {
    return {
      wheres:    this._wheres,
      rawWheres: this._rawWheres,
      selects:   this._selects,
      joins:     this._joins,
      orderBys:  this._orderBys,
      groupBys:  this._groupBys,
      havings:   this._havings,
      limit:     this._limit,
      offset:    this._offset,
      distinct:  this._distinct,
    }
  }

  // Make the QueryBuilder itself await-able (returns Collection)
  then(resolve, reject) {
    return this.get().then(resolve, reject)
  }
}
