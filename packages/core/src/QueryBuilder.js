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
import { ModelNotFoundException, RelationNotFoundException } from './errors.js'
import { assertOperator } from './utils.js'
import { HookRegistry } from './HookRegistry.js'

/**
 * @template {typeof import('./Model.js').Model} [T=typeof import('./Model.js').Model]
 */
export class QueryBuilder {
  /**
   * @param {T} ModelClass
   * @param {import('./Model.js').ModelResolver} resolver
   */
  constructor(ModelClass, resolver) {
    this._model    = ModelClass
    this._resolver = resolver
    this._wheres    = []
    this._rawWheres = []
    /** @type {(string | {raw: string})[]} */
    this._selects   = ['*']
    this._joins     = []
    this._orderBys  = []
    this._groupBys  = []
    this._havings   = []
    this._limit     = null
    this._offset    = null
    this._withs     = []
    this._withAggregates = []  // {relation, fn, column, alias, constraints}
    this._distinct  = false
    this._lock      = null
    this._unions    = []       // {table, ctx, all}
    this._globalScopes  = {}   // name -> scope fn (for withoutGlobalScope)
  }

  /**
   * An independent copy of this builder. Needed because the builder is mutable:
   * without it, reusing one for a count and a page mutates shared state.
   * @returns {QueryBuilder<T>}
   */
  clone() {
    const qb = new QueryBuilder(this._model, this._resolver)
    qb._wheres = this._wheres.map(w => ({ ...w }))
    qb._rawWheres = this._rawWheres.map(w => ({ ...w }))
    qb._selects = [...this._selects]
    qb._joins = this._joins.map(j => ({ ...j }))
    qb._orderBys = this._orderBys.map(o => ({ ...o }))
    qb._groupBys = [...this._groupBys]
    qb._havings = this._havings.map(h => ({ ...h }))
    qb._limit = this._limit
    qb._offset = this._offset
    qb._withs = this._withs.map(w => ({ ...w }))
    qb._withAggregates = this._withAggregates.map(a => ({ ...a }))
    qb._distinct = this._distinct
    qb._lock = this._lock
    qb._unions = [...this._unions]
    qb._globalScopes = { ...this._globalScopes }
    return qb
  }

  // ─── WHERE ───────────────────────────────────────────────────────────────────
  where(column, operator, value, boolean = 'and') {
    // where(qb => ...) nested group
    if (typeof column === 'function') return this._whereGroup(column, boolean)
    // where({ key: val, ... }) object shorthand
    if (column !== null && typeof column === 'object' && !Array.isArray(column)) {
      const apply = qb => { for (const [k, v] of Object.entries(column)) qb.where(k, v) }
      return boolean === 'or' ? this._whereGroup(apply, 'or') : (apply(this), this)
    }
    // where('col', val)  — two-arg shorthand for equality
    if (value === undefined) { value = operator; operator = '=' }
    // `where('col', null)` means IS NULL. `= NULL` matches nothing in SQL, so
    // the old behaviour silently returned an empty result.
    if (value === null && (operator === '=' || operator === '!=' || operator === '<>')) {
      return operator === '=' ? this.whereNull(column, boolean) : this.whereNotNull(column, boolean)
    }
    this._wheres.push({ column, operator: assertOperator(operator), value, boolean })
    return this
  }

  orWhere(column, operator, value) {
    return this.where(column, operator, value, 'or')
  }

  /**
   * Collect the wheres a callback registers into one parenthesized group.
   * The sub-builder gets no global scopes — Model.query() only applies those
   * to the outer builder, which is what keeps `(a OR b)` from leaking past
   * the soft-delete filter.
   */
  _whereGroup(fn, boolean) {
    const sub = new QueryBuilder(this._model, this._resolver)
    fn(sub)
    if (sub._wheres.length || sub._rawWheres.length) {
      this._wheres.push({ type: 'group', wheres: sub._wheres, rawWheres: sub._rawWheres, boolean })
    }
    return this
  }

  /**
   * Negate a condition. With a callback this is a group negation like Laravel's;
   * with a column/value pair it stays the `!=` shorthand.
   */
  whereNot(column, operator, value) {
    if (typeof column === 'function') {
      this._wheres.push({ type: 'not', wheres: this._collect(column), boolean: 'and' })
      return this
    }
    if (value === undefined) { value = operator; operator = '=' }
    return this.where(column, operator === '=' ? '!=' : operator, value)
  }

  orWhereNot(column, operator, value) {
    if (typeof column === 'function') {
      this._wheres.push({ type: 'not', wheres: this._collect(column), boolean: 'or' })
      return this
    }
    if (value === undefined) { value = operator; operator = '=' }
    return this.where(column, operator === '=' ? '!=' : operator, value, 'or')
  }

  whereIn(column, values, boolean = 'and')       { this._wheres.push({ type: 'in',      column, values, boolean }); return this }
  whereNotIn(column, values, boolean = 'and')    { this._wheres.push({ type: 'notIn',   column, values, boolean }); return this }
  whereNull(column, boolean = 'and')             { this._wheres.push({ type: 'null',    column,         boolean }); return this }
  whereNotNull(column, boolean = 'and')          { this._wheres.push({ type: 'notNull', column,         boolean }); return this }
  whereBetween(column, [min, max], boolean = 'and')    { this._wheres.push({ type: 'between', column, min, max, boolean }); return this }
  whereNotBetween(col, [min, max], boolean = 'and')    { this._wheres.push({ type: 'notBetween', column: col, min, max, boolean }); return this }
  whereLike(column, pattern)       { return this.where(column, 'LIKE', pattern) }
  whereNotLike(column, pattern)    { return this.where(column, 'NOT LIKE', pattern) }

  // OR variants — every non-basic where used to hard-code boolean:'and',
  // so there was no way to express `a OR b IN (...)`.
  orWhereIn(column, values)        { return this.whereIn(column, values, 'or') }
  orWhereNotIn(column, values)     { return this.whereNotIn(column, values, 'or') }
  orWhereNull(column)              { return this.whereNull(column, 'or') }
  orWhereNotNull(column)           { return this.whereNotNull(column, 'or') }
  orWhereBetween(column, range)    { return this.whereBetween(column, range, 'or') }
  orWhereNotBetween(column, range) { return this.whereNotBetween(column, range, 'or') }
  orWhereLike(column, pattern)     { return this.where(column, 'LIKE', pattern, 'or') }
  orWhereNotLike(column, pattern)  { return this.where(column, 'NOT LIKE', pattern, 'or') }

  whereDate(column, operator, value, boolean = 'and') {
    if (value === undefined) { value = operator; operator = '=' }
    this._wheres.push({ type: 'date', column, operator: assertOperator(operator), value, boolean })
    return this
  }
  orWhereDate(column, operator, value) { return this.whereDate(column, operator, value, 'or') }

  whereTime(column, operator, value, boolean = 'and') {
    if (value === undefined) { value = operator; operator = '=' }
    this._wheres.push({ type: 'time', column, operator: assertOperator(operator), value, boolean })
    return this
  }
  orWhereTime(column, operator, value) { return this.whereTime(column, operator, value, 'or') }

  whereYear(column, year, boolean = 'and') {
    this._wheres.push({ type: 'year', column, value: year, boolean })
    return this
  }
  whereMonth(column, month, boolean = 'and') {
    this._wheres.push({ type: 'month', column, value: month, boolean })
    return this
  }
  whereDay(column, day, boolean = 'and') {
    this._wheres.push({ type: 'day', column, value: day, boolean })
    return this
  }

  /** Compare two columns: whereColumn('updated_at', '>', 'created_at') */
  whereColumn(first, operator, second, boolean = 'and') {
    if (second === undefined) { second = operator; operator = '=' }
    this._wheres.push({ type: 'column', first, operator: assertOperator(operator), second, boolean })
    return this
  }
  orWhereColumn(first, operator, second) { return this.whereColumn(first, operator, second, 'or') }

  /**
   * Correlated EXISTS against another model.
   * @param {typeof import('./Model.js').Model} Related
   * @param {(qb: QueryBuilder) => void} [callback]
   */
  whereExists(Related, callback, boolean = 'and', negate = false) {
    const sub = Related.query()
    callback?.(sub)
    this._wheres.push({
      type: negate ? 'notExists' : 'exists',
      table: Related.getTable(),
      ctx: sub._buildContext(),
      boolean,
    })
    return this
  }
  whereNotExists(Related, callback) { return this.whereExists(Related, callback, 'and', true) }
  orWhereExists(Related, callback) { return this.whereExists(Related, callback, 'or') }

  whereJsonContains(column, value, boolean = 'and') {
    this._wheres.push({ type: 'jsonContains', column, value, boolean })
    return this
  }
  whereRaw(sql, bindings = []) {
    this._rawWheres.push({ sql, bindings })
    return this
  }

  // ─── RELATIONSHIP EXISTENCE ──────────────────────────────────────────────────
  /**
   * Constrain by the existence of a relation — Eloquent's `whereHas`.
   *   Post.whereHas('comments', qb => qb.where('approved', true))
   * Implemented as a correlated EXISTS built from the relation's own keys, so
   * it works for hasOne/hasMany/belongsTo/morphOne/morphMany.
   *
   * @param {string} relation
   * @param {(qb: QueryBuilder) => void} [callback]
   */
  whereHas(relation, callback, boolean = 'and', negate = false) {
    const { Related, sub } = this._relationSubquery(relation, callback)
    this._wheres.push({
      type: negate ? 'notExists' : 'exists',
      table: Related.getTable(),
      ctx: sub._buildContext(),
      boolean,
    })
    return this
  }

  orWhereHas(relation, callback) { return this.whereHas(relation, callback, 'or') }
  whereDoesntHave(relation, callback) { return this.whereHas(relation, callback, 'and', true) }
  orWhereDoesntHave(relation, callback) { return this.whereHas(relation, callback, 'or', true) }
  has(relation, callback) { return this.whereHas(relation, callback) }
  doesntHave(relation, callback) { return this.whereDoesntHave(relation, callback) }

  /**
   * Add a `${relation}_count` column — Eloquent's `withCount`.
   * Accepts 'comments', ['comments', 'likes'] or {comments: qb => ...}.
   */
  withCount(...relations) { return this._withAggregate('count', '*', relations) }
  withExists(...relations) { return this._withAggregate('exists', '*', relations) }
  withSum(relation, column) { return this._withAggregate('sum', column, [relation]) }
  withAvg(relation, column) { return this._withAggregate('avg', column, [relation]) }
  withMax(relation, column) { return this._withAggregate('max', column, [relation]) }
  withMin(relation, column) { return this._withAggregate('min', column, [relation]) }

  _withAggregate(fn, column, relations) {
    for (const rel of relations.flat()) {
      if (typeof rel === 'string') {
        this._withAggregates.push({ relation: rel, fn, column, constraints: null })
      } else if (rel && typeof rel === 'object') {
        for (const [name, constraints] of Object.entries(rel)) {
          this._withAggregates.push({ relation: name, fn, column, constraints })
        }
      }
    }
    return this
  }

  /**
   * Build a builder over the related table, correlated to this one by the
   * relation's keys. Shared by whereHas() and the withCount() family.
   */
  _relationSubquery(relation, callback) {
    const probe = new this._model()
    if (typeof probe[relation] !== 'function') {
      throw new RelationNotFoundException(`${this._model.name} has no relation "${relation}"`)
    }
    const rel = probe[relation]()
    const keys = rel?.correlationKeys?.()
    if (!keys) {
      throw new RelationNotFoundException(
        `Relation "${relation}" on ${this._model.name} does not support existence queries.`
      )
    }

    const Related = keys.Related
    const sub = Related.query()
    sub.whereColumn(
      `${Related.getTable()}.${keys.foreignKey}`,
      '=',
      `${this._model.getTable()}.${keys.localKey}`
    )
    for (const [col, value] of Object.entries(keys.extraWheres ?? {})) sub.where(col, value)
    callback?.(sub)
    return { Related, sub, keys }
  }

  /** Collect the wheres a callback registers, without attaching them. */
  _collect(fn) {
    const sub = new QueryBuilder(this._model, this._resolver)
    fn(sub)
    return sub._wheres
  }

  // ─── SELECT ──────────────────────────────────────────────────────────────────
  select(...columns)  { this._selects = columns.flat(); return this }
  addSelect(...cols)  { this._selects = [...this._selects.filter(c => c !== '*'), ...cols.flat()]; return this }
  selectRaw(expr)     { this._selects = [{ raw: expr }]; return this }
  distinct()          { this._distinct = true; return this }

  // ─── JOINS ───────────────────────────────────────────────────────────────────
  _join(type, table, first, operator, second) {
    if (second === undefined) { second = operator; operator = '=' }
    this._joins.push({ type, table, first, operator: assertOperator(operator), second })
    return this
  }
  join(table, first, operator, second)      { return this._join('INNER', table, first, operator, second) }
  leftJoin(table, first, operator, second)  { return this._join('LEFT',  table, first, operator, second) }
  rightJoin(table, first, operator, second) { return this._join('RIGHT', table, first, operator, second) }
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

  /** Discard existing ordering (optionally replacing it) — Laravel's reorder(). */
  reorder(column = null, direction = 'asc') {
    this._orderBys = []
    return column ? this.orderBy(column, direction) : this
  }

  groupBy(...columns) { this._groupBys.push(...columns.flat()); return this }
  groupByRaw(expression) { this._groupBys.push({ raw: expression }); return this }

  having(column, operator, value) {
    if (value === undefined) { value = operator; operator = '=' }
    this._havings.push({ column, operator: assertOperator(operator), value })
    return this
  }
  havingRaw(expression) { this._havings.push({ raw: expression }); return this }
  havingBetween(column, [min, max]) {
    return this.having(column, '>=', min).having(column, '<=', max)
  }
  /** HAVING over an aggregate: havingAggregate('count', '*', '>', 3) */
  havingAggregate(fn, column, operator, value) {
    if (value === undefined) { value = operator; operator = '=' }
    this._havings.push({ aggregate: fn, column, operator: assertOperator(operator), value })
    return this
  }

  // ─── UNION ───────────────────────────────────────────────────────────────────
  /**
   * Append another query with UNION. The other query may be over a different
   * model, as long as the two select lists line up.
   *
   *   Post.select('id', 'title').union(Page.select('id', 'title')).orderBy('title')
   *
   * This builder's ORDER BY / LIMIT apply to the combined result, which is what
   * SQL does; the appended query's own ordering and limit are dropped, since a
   * non-final branch of a compound SELECT cannot carry them.
   *
   * @param {QueryBuilder|{getQuery: () => QueryBuilder}} query
   * @param {boolean} [all] UNION ALL — keeps duplicate rows
   */
  union(query, all = false) {
    const qb = typeof (/** @type {any} */ (query).getQuery) === 'function'
      ? /** @type {any} */ (query).getQuery()
      : /** @type {QueryBuilder} */ (query)
    this._unions.push({ table: qb._model.getTable(), ctx: qb._buildContext(), all })
    return this
  }

  unionAll(query) { return this.union(query, true) }

  // ─── LOCKING ─────────────────────────────────────────────────────────────────
  lockForUpdate() { this._lock = 'update'; return this }
  sharedLock()    { this._lock = 'shared'; return this }

  // ─── CONDITIONAL / TAP ───────────────────────────────────────────────────────
  /** Apply `callback` only when `value` is truthy. */
  when(value, callback, otherwise = null) {
    const test = typeof value === 'function' ? value(this) : value
    if (test) return callback(this, test) ?? this
    if (otherwise) return otherwise(this, test) ?? this
    return this
  }

  unless(value, callback, otherwise = null) {
    const test = typeof value === 'function' ? value(this) : value
    return this.when(!test, callback, otherwise)
  }

  /** Run a side effect on the builder and keep chaining. */
  tap(callback) { callback(this); return this }

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
  /** aggregate() is optional in the resolver contract — fail with a clear message. */
  _aggregate(fn, column) {
    if (this._unions.length) {
      // COUNT() would apply to the first branch only and quietly under-report,
      // which is worse than not supporting it.
      throw new Error(
        '[EloquentJS] count()/sum()/paginate() cannot aggregate over a union. ' +
        'Count the branches separately, or use simplePaginate()/cursorPaginate().'
      )
    }
    if (typeof this._resolver.aggregate !== 'function') {
      throw new Error(
        `[EloquentJS] ${this._resolver.constructor.name} does not implement aggregate(), ` +
        `so count()/sum()/exists() are unavailable on this connection.`
      )
    }
    return this._resolver.aggregate(this._model.getTable(), fn, column, this._buildContext())
  }

  async count(column = '*') { return this._aggregate('count', column) }
  async max(column)         { return this._aggregate('max', column) }
  async min(column)         { return this._aggregate('min', column) }
  async sum(column)         { return this._aggregate('sum', column) }
  async avg(column)         { return this._aggregate('avg', column) }
  async exists()     { return (await this.count()) > 0 }
  async doesntExist(){ return !(await this.exists()) }

  // ─── EXECUTION ───────────────────────────────────────────────────────────────
  /** @returns {Promise<Collection<InstanceType<T>>>} */
  async get() {
    const rows = await this._resolver.select(this._model.getTable(), this._buildContext())
    return new Collection(await this._hydrateAll(rows))
  }

  /** Hydrate rows, run eager loads and aggregates, fire `retrieved`. */
  async _hydrateAll(rows) {
    const models = rows.map(row => this._model._hydrate(row))
    if (this._withAggregates.length > 0) await this._loadAggregates(models)
    if (this._withs.length > 0) await this._eagerLoad(models)
    const hooks = HookRegistry.for(this._model)
    for (const model of models) await hooks.fire('retrieved', model)
    return models
  }

  /** @returns {Promise<InstanceType<T> | null>} */
  async first() {
    const ctx = { ...this.clone()._buildContext(), limit: 1 }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    if (!rows.length) return null
    return (await this._hydrateAll(rows))[0]
  }

  /** @returns {Promise<InstanceType<T>>} */
  async firstOrFail() {
    const m = await this.first()
    if (!m) throw new ModelNotFoundException(`No ${this._model.name} record found`)
    return m
  }

  /** Exactly one row, or throw — Laravel's sole(). */
  async sole() {
    const ctx = { ...this.clone()._buildContext(), limit: 2 }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    if (!rows.length) throw new ModelNotFoundException(`No ${this._model.name} record found`)
    if (rows.length > 1) throw new Error(`[EloquentJS] Multiple ${this._model.name} records matched sole()`)
    return (await this._hydrateAll(rows))[0]
  }

  async find(id) {
    return this.clone().where(this._model.primaryKey, id).first()
  }

  /** find(), falling back to `callback()` (or a value) when nothing matches. */
  async findOr(id, callback) {
    const found = await this.find(id)
    if (found) return found
    return typeof callback === 'function' ? callback() : callback
  }

  /**
   * @returns {Promise<any[]|Map<any, any>>} a Map when `keyBy` is given —
   * matching Collection.pluck(), and safe for numeric or `__proto__` keys.
   */
  async pluck(column, keyBy = null) {
    const ctx = { ...this._buildContext(), selects: keyBy ? [column, keyBy] : [column] }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    if (keyBy) return new Map(rows.map(r => [r[keyBy], r[column]]))
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
      const models = new Collection(await this._hydrateAll(rows))
      const cont = await callback(models, page)
      if (cont === false || rows.length < size) break
      page++
    }
  }

  /**
   * Chunk by ascending primary key rather than OFFSET. Safe when the callback
   * modifies rows — OFFSET paging skips records as earlier ones shift.
   */
  async chunkById(size, callback, column = null) {
    const key = column ?? this._model.primaryKey
    let lastId = null
    let page = 1
    while (true) {
      const qb = this.clone().reorder(key, 'asc').limit(size)
      if (lastId !== null) qb.where(key, '>', lastId)
      const rows = await this._resolver.select(this._model.getTable(), qb._buildContext())
      if (!rows.length) break
      const models = new Collection(await this._hydrateAll(rows))
      const cont = await callback(models, page)
      if (cont === false || rows.length < size) break
      lastId = rows[rows.length - 1][key]
      page++
    }
  }

  /**
   * Stream results one model at a time, a chunk per round trip.
   * `for await (const user of User.query().lazy()) { ... }`
   */
  async *lazy(chunkSize = 1000) {
    let page = 1
    while (true) {
      const ctx = { ...this._buildContext(), limit: chunkSize, offset: (page - 1) * chunkSize }
      const rows = await this._resolver.select(this._model.getTable(), ctx)
      if (!rows.length) return
      for (const model of await this._hydrateAll(rows)) yield model
      if (rows.length < chunkSize) return
      page++
    }
  }

  /** Alias of lazy() — Laravel's cursor(). */
  cursor() { return this.lazy() }

  /** Run `callback` for every row, chunked. Stops when it returns false. */
  async each(callback, chunkSize = 1000) {
    let index = 0
    for await (const model of this.lazy(chunkSize)) {
      if (await callback(model, index++) === false) return false
    }
    return true
  }

  async paginate(page = 1, perPage = 15) {
    page = Math.max(1, Number(page) || 1)
    perPage = Math.max(1, Number(perPage) || 15)

    // Count on a clean copy — no limit/offset/order, and no eager-load work.
    // groupBys are kept: drivers count the groups, not the first group's rows.
    const countQb = this.clone()
    countQb._selects = ['*']
    countQb._orderBys = []
    countQb._limit = null
    countQb._offset = null
    countQb._lock = null
    const total = await countQb.count('*')

    const dataQb = this.clone().forPage(page, perPage)
    const rows = await this._resolver.select(this._model.getTable(), dataQb._buildContext())
    const models = await this._hydrateAll(rows)

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

  /**
   * Paginate without the COUNT query — fetches perPage + 1 rows to learn
   * whether another page exists. Cheaper on large tables.
   */
  async simplePaginate(page = 1, perPage = 15) {
    page = Math.max(1, Number(page) || 1)
    perPage = Math.max(1, Number(perPage) || 15)

    const ctx = { ...this.clone()._buildContext(), limit: perPage + 1, offset: (page - 1) * perPage }
    const rows = await this._resolver.select(this._model.getTable(), ctx)
    const hasMore = rows.length > perPage
    const models = await this._hydrateAll(rows.slice(0, perPage))

    return {
      data: new Collection(models),
      meta: {
        per_page: perPage,
        current_page: page,
        from: models.length ? (page - 1) * perPage + 1 : null,
        to: models.length ? (page - 1) * perPage + models.length : null,
        has_more: hasMore,
      },
    }
  }

  /**
   * Keyset pagination — Laravel's cursorPaginate(). Cursor is a base64 blob
   * around the first orderBy column's value (defaulting to an ascending
   * primaryKey order), so paging is stable even while rows are inserted/deleted
   * elsewhere in the table — unlike offset paging.
   *
   * ponytail: single-column cursor, forward direction only (no `.previous()`
   * "or" symmetry Laravel offers). Add a second column / backward cursor if a
   * caller needs to page a non-unique first orderBy column or paginate backward.
   */
  async cursorPaginate(perPage = 15, cursor = null) {
    perPage = Math.max(1, Number(perPage) || 15)
    const qb = this.clone()
    if (!qb._orderBys.length) qb.orderBy(this._model.primaryKey, 'asc')
    const { column: key, direction } = qb._orderBys[0]
    if (cursor) {
      const { v } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      qb.where(key, direction === 'DESC' ? '<' : '>', v)
    }
    qb._limit = perPage + 1
    const rows = await this._resolver.select(this._model.getTable(), qb._buildContext())
    const hasMore = rows.length > perPage
    const models = await this._hydrateAll(rows.slice(0, perPage))
    const last = models[models.length - 1]
    const nextCursor = hasMore && last
      ? Buffer.from(JSON.stringify({ v: last.getRawAttribute(key) })).toString('base64url')
      : null

    return {
      data: new Collection(models),
      meta: { per_page: perPage, next_cursor: nextCursor, has_more: hasMore },
    }
  }

  // ─── WRITES (bulk) ────────────────────────────────────────────────────────────
  /** Bulk update. Touches updated_at, as Eloquent's mass update does. */
  async update(attributes) {
    const Klass = this._model
    const data = Klass.timestamps && !(Klass.updatedAtColumn in attributes)
      ? { ...attributes, [Klass.updatedAtColumn]: new Date() }
      : attributes
    return this._resolver.update(Klass.getTable(), null, data, this._buildContext())
  }

  /** Bulk update without touching updated_at. */
  async updateQuietly(attributes) {
    return this._resolver.update(this._model.getTable(), null, attributes, this._buildContext())
  }

  /**
   * Insert rows, updating those that collide on `uniqueBy`.
   * Falls back to a per-row select+update/insert when the driver has no native
   * upsert, so the semantics are the same everywhere.
   * @param {Record<string, any>[]} rows
   * @param {string|string[]} uniqueBy
   * @param {string[]|null} update
   */
  async upsert(rows, uniqueBy, update = null) {
    const list = [rows].flat()
    if (!list.length) return 0
    const keys = [uniqueBy].flat()

    if (typeof this._resolver.upsert === 'function') {
      return this._resolver.upsert(this._model.getTable(), list, keys, update)
    }

    let affected = 0
    for (const row of list) {
      const conditions = Object.fromEntries(keys.map(k => [k, row[k]]))
      const columns = update ?? Object.keys(row).filter(k => !keys.includes(k))
      const values = Object.fromEntries(columns.map(k => [k, row[k]]))
      const changed = Object.keys(values).length
        ? await this._resolver.update(this._model.getTable(), conditions, values)
        : 0
      if (changed) { affected += changed; continue }
      const existing = await this.clone().where(conditions).first()
      if (!existing) { await this._resolver.insert(this._model.getTable(), row); affected++ }
    }
    return affected
  }

  /** Update the matching row, or insert it if there is none. */
  async updateOrInsert(conditions, values = {}) {
    const changed = await this.clone().where(conditions).update(values)
    if (changed) return changed
    await this._resolver.insert(this._model.getTable(), { ...conditions, ...values })
    return 1
  }

  /** Insert one row and return the new primary key. */
  async insertGetId(row) {
    const result = await this._resolver.insert(this._model.getTable(), row)
    const key = this._model.primaryKey
    return result?.[key] ?? result?.insertedId?.toString() ?? null
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
    if (typeof this._resolver.increment !== 'function') {
      throw new Error(`[EloquentJS] ${this._resolver.constructor.name} does not implement increment()`)
    }
    return this._resolver.increment(
      this._model.getTable(), column, amount, extra, this._buildContext()
    )
  }

  async decrement(column, amount = 1, extra = {}) {
    return this.increment(column, -Math.abs(amount), extra)
  }

  // ─── DEBUG ────────────────────────────────────────────────────────────────────
  async toSQL() {
    if (typeof this._resolver.toSQL !== 'function') {
      throw new Error(`[EloquentJS] ${this._resolver.constructor.name} does not implement toSQL()`)
    }
    return this._resolver.toSQL(this._model.getTable(), this._buildContext())
  }

  /** Log the query and keep chaining. */
  async dump() {
    const { sql, params, ...rest } = await this.toSQL()
    console.log('[EloquentJS SQL]', sql ?? rest)
    if (params) console.log('[EloquentJS PARAMS]', params)
    return this
  }

  /** Log the query and stop — awaits, unlike the old fire-and-forget version. */
  async dd() {
    await this.dump()
    throw new Error('[EloquentJS] dd() — query dumped, execution halted.')
  }

  // ─── EAGER LOADING ───────────────────────────────────────────────────────────
  /**
   * @param {any[]} models
   * @param {(string|Record<string, Function>)[]} [relations] explicit list, for
   *   Model.load(); defaults to whatever with() registered on this builder.
   */
  async _eagerLoad(models, relations = null) {
    if (!models.length) return
    let withs = this._withs
    if (relations) {
      const collector = new QueryBuilder(this._model, this._resolver)
      collector.with(...[relations].flat())
      withs = collector._withs
    }

    for (const { name: fullName, constraints } of withs) {
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

  /**
   * Resolve withCount/withSum/… into `${relation}_count` attributes.
   * One aggregate query per relation for the whole batch — not per row.
   */
  async _loadAggregates(models) {
    if (!models.length) return
    const parentKeyValues = new Map()   // localKey → [models]

    for (const { relation, fn, column, constraints } of this._withAggregates) {
      const { Related, keys } = this._relationSubquery(relation, null)
      const alias = `${relation}_${fn === 'exists' ? 'exists' : fn}${fn === 'count' ? '' : `_${column}`}`

      parentKeyValues.clear()
      for (const m of models) {
        const v = m.getRawAttribute(keys.localKey)
        if (v == null) continue
        if (!parentKeyValues.has(v)) parentKeyValues.set(v, [])
        parentKeyValues.get(v).push(m)
      }
      const ids = [...parentKeyValues.keys()]
      if (!ids.length) {
        for (const m of models) m.setRelationAggregate(alias, fn === 'exists' ? false : 0)
        continue
      }

      const sub = Related.query().whereIn(keys.foreignKey, ids)
      for (const [col, value] of Object.entries(keys.extraWheres ?? {})) sub.where(col, value)
      constraints?.(sub)

      // Group by the foreign key and aggregate per group.
      const rows = await this._resolver.select(Related.getTable(), {
        ...sub._buildContext(),
        selects: [
          keys.foreignKey,
          { raw: `${fn === 'exists' ? 'COUNT' : fn.toUpperCase()}(${column === '*' ? '*' : column}) AS _agg` },
        ],
        groupBys: [keys.foreignKey],
      })

      const byKey = new Map(rows.map(r => [String(r[keys.foreignKey]), Number(r._agg)]))
      for (const [value, group] of parentKeyValues) {
        const agg = byKey.get(String(value)) ?? 0
        for (const m of group) m.setRelationAggregate(alias, fn === 'exists' ? agg > 0 : agg)
      }
    }
  }

  // ─── BUILD CONTEXT ───────────────────────────────────────────────────────────
  /**
   * Global scopes (soft deletes, Model.addGlobalScope) must AND against the
   * *whole* user query. Left flat, `scope AND a OR b` parses as
   * `(scope AND a) OR b` and returns rows the scope excluded — so wrap the
   * user wheres in a group as soon as one of them is an OR.
   */
  _scopedWheres() {
    const user = this._wheres.filter(w => !w._scope)
    if (!user.some(w => w.boolean === 'or')) return this._wheres
    const scoped = this._wheres.filter(w => w._scope)
    if (!scoped.length) return this._wheres
    return [...scoped, { type: 'group', wheres: user, boolean: 'and' }]
  }

  _buildContext() {
    return {
      wheres:    this._scopedWheres(),
      rawWheres: this._rawWheres,
      selects:   this._selects,
      joins:     this._joins,
      orderBys:  this._orderBys,
      groupBys:  this._groupBys,
      havings:   this._havings,
      limit:     this._limit,
      offset:    this._offset,
      distinct:  this._distinct,
      lock:      this._lock,
      unions:    this._unions,
    }
  }

  // Make the QueryBuilder itself await-able (returns Collection)
  then(resolve, reject) {
    return this.get().then(resolve, reject)
  }
}
