/**
 * @eloquentjs/core — Collection
 *
 * Rich wrapper around query results. Extends Array so all native Array
 * methods still work. Collection-returning methods return new Collections.
 * @template T
 * @extends {Array<T>}
 */
export class Collection extends Array {
  /**
   * Construct from an existing array without calling Array(n) with a number.
   * This avoids the Array(n) trap where new Array(5) creates a sparse array.
   * @param {T[]} items
   */
  constructor(items = []) {
    super()
    if (items.length) this.push(...items)
  }

  // ─── Access ──────────────────────────────────────────────────────────────────
  first(fn = null) {
    if (!fn) return this.length > 0 ? this[0] : null
    return this.find(fn) ?? null
  }
  last(fn = null) {
    if (!fn) return this.length > 0 ? this[this.length - 1] : null
    for (let i = this.length - 1; i >= 0; i--) if (fn(this[i], i)) return this[i]
    return null
  }
  nth(n)       { return this[n] ?? null }
  isEmpty()    { return this.length === 0 }
  isNotEmpty() { return this.length > 0 }

  /** Exactly one item, or throw — Laravel's sole(). */
  sole(fn = null) {
    const matches = fn ? this.filter(fn) : this
    if (!matches.length) throw new Error('[EloquentJS] Collection.sole(): no matching item')
    if (matches.length > 1) throw new Error(`[EloquentJS] Collection.sole(): ${matches.length} items matched`)
    return matches[0]
  }

  /**
   * Read a key from an item the same way everywhere: through getAttribute()
   * when there is one, so casts and accessors apply. `whereIn`/`sum`/`min`
   * used to read `item[key]` directly and disagree with `where()`.
   */
  _read(item, key) {
    if (key == null) return item
    if (typeof key === 'function') return key(item)
    const anyItem = /** @type {any} */ (item)
    return typeof anyItem?.getAttribute === 'function' ? anyItem.getAttribute(key) : anyItem?.[key]
  }

  // ─── Pluck / Key ─────────────────────────────────────────────────────────────
  pluck(valueKey, keyKey = null) {
    if (keyKey) {
      const map = new Map()
      for (const item of this) map.set(this._read(item, keyKey), this._read(item, valueKey))
      return map
    }
    return new Collection(this.map(item => this._read(item, valueKey)))
  }

  /** @returns {Map<any, T>} */
  keyBy(key) {
    const map = new Map()
    for (const item of this) map.set(this._read(item, key), item)
    return map
  }

  /** @returns {Map<any, Collection<T>>} */
  groupBy(key) {
    const map = new Map()
    for (const item of this) {
      const k = this._read(item, key)
      if (!map.has(k)) map.set(k, new Collection())
      map.get(k).push(item)
    }
    return map
  }

  /** The primary keys of the models in this collection. */
  modelKeys() {
    return new Collection(this.map(item => {
      const anyItem = /** @type {any} */ (item)
      return anyItem?.getAttribute?.(anyItem.constructor.primaryKey) ?? anyItem?.id
    }))
  }

  // ─── Filtering ───────────────────────────────────────────────────────────────
  where(key, operatorOrValue, value) {
    let operator, val
    if (value === undefined) { operator = '='; val = operatorOrValue }
    else { operator = operatorOrValue; val = value }

    return new Collection(this.filter(item => {
      const iv = this._read(item, key)
      switch (operator) {
        // `=` is deliberately loose so `where('id', '1')` matches a numeric 1,
        // the way a database comparison would. `===` is the strict variant.
        case '=':
        case '==':  return iv == val   // eslint-disable-line eqeqeq
        case '===': return iv === val
        case '!=':
        case '<>':  return iv != val   // eslint-disable-line eqeqeq
        case '!==': return iv !== val
        case '>':   return iv > val
        case '>=':  return iv >= val
        case '<':   return iv < val
        case '<=':  return iv <= val
        default:    return false
      }
    }))
  }

  whereIn(key, values) {
    const set = new Set(values)
    return new Collection(this.filter(item => set.has(this._read(item, key))))
  }

  whereNotIn(key, values) {
    const set = new Set(values)
    return new Collection(this.filter(item => !set.has(this._read(item, key))))
  }

  whereNull(key) {
    return new Collection(this.filter(item => this._read(item, key) == null))
  }

  whereNotNull(key) {
    return new Collection(this.filter(item => this._read(item, key) != null))
  }

  /** Does the collection contain this item / key-value pair / match? */
  contains(keyOrFn, value) {
    if (typeof keyOrFn === 'function') return this.some(keyOrFn)
    if (value === undefined) return this.some(item => item === keyOrFn || this._read(item, null) === keyOrFn)
    // Loose on purpose, matching where().
    // eslint-disable-next-line eqeqeq
    return this.some(item => this._read(item, keyOrFn) == value)
  }

  doesntContain(...args) { return !this.contains(...args) }

  /** @returns {[Collection<T>, Collection<T>]} matching, then the rest. */
  partition(fn) {
    const pass = new Collection()
    const fail = new Collection()
    for (const item of this) (fn(item) ? pass : fail).push(item)
    return [pass, fail]
  }

  // ─── Aggregates ──────────────────────────────────────────────────────────────
  /** With no key, sums the items themselves (used to return 0). */
  sum(key = null) {
    return this.reduce((acc, item) => acc + (Number(this._read(item, key)) || 0), 0)
  }
  avg(key = null) {
    return this.length === 0 ? 0 : this.sum(key) / this.length
  }
  min(key = null) {
    if (!this.length) return null
    return this.reduce((m, item) => {
      const v = this._read(item, key)
      return v < m ? v : m
    }, this._read(this[0], key))
  }
  max(key = null) {
    if (!this.length) return null
    return this.reduce((m, item) => {
      const v = this._read(item, key)
      return v > m ? v : m
    }, this._read(this[0], key))
  }
  median(key = null) {
    if (!this.length) return null
    const sorted = this.map(i => Number(this._read(i, key))).sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  count() { return this.length }

  /**
   * Join values with a separator.
   *   implode('name', ', ')  → 'Alice, Bob'
   *   implode(', ')          → over primitives
   */
  implode(key, glue) {
    if (glue === undefined) return this.join(key ?? ',')
    return this.map(item => this._read(item, key)).join(glue)
  }

  // ─── Sorting ─────────────────────────────────────────────────────────────────
  sortBy(key, direction = 'asc') {
    const dir = direction === 'desc' ? -1 : 1
    return new Collection([...this].sort((a, b) => {
      const va = typeof key === 'function' ? key(a) : a[key]
      const vb = typeof key === 'function' ? key(b) : b[key]
      if (va === vb) return 0
      return (va > vb ? 1 : -1) * dir
    }))
  }
  sortByDesc(key) { return this.sortBy(key, 'desc') }

  // ─── Transformation ──────────────────────────────────────────────────────────
  unique(key = null) {
    const seen = new Set()
    return new Collection(this.filter(item => {
      const k = this._read(item, key)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }))
  }

  chunk(size) {
    const chunks = new Collection()
    for (let i = 0; i < this.length; i += size) {
      chunks.push(new Collection(this.slice(i, i + size)))
    }
    return chunks
  }

  /** A random item, or `n` random items. */
  random(n = null) {
    if (!this.length) return n === null ? null : new Collection()
    const shuffled = this.shuffle()
    return n === null ? shuffled[0] : new Collection(shuffled.slice(0, n))
  }

  shuffle() {
    const items = [...this]
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[items[i], items[j]] = [items[j], items[i]]
    }
    return new Collection(items)
  }

  /** Both only() and except() read through toJSON(), so they stay symmetric. */
  only(...keys) {
    const flat = keys.flat()
    return new Collection(this.map(item => {
      const anyItem = /** @type {any} */ (item)
      const src = anyItem?.toJSON?.() ?? anyItem
      const out = {}
      for (const k of flat) if (k in src) out[k] = src[k]
      return out
    }))
  }

  except(...keys) {
    const exclude = new Set(keys.flat())
    return new Collection(this.map(item => {
      const anyItem = /** @type {any} */ (item)
      const src = anyItem?.toJSON?.() ?? anyItem
      const out = {}
      for (const [k, v] of Object.entries(src)) {
        if (!exclude.has(k)) out[k] = v
      }
      return out
    }))
  }

  mapInto(Klass) {
    return new Collection(this.map(item => {
      const anyItem = /** @type {any} */ (item)
      return new Klass(anyItem?.toJSON?.() ?? anyItem)
    }))
  }

  flatten() {
    return new Collection(this.flat())
  }

  // ─── Side-effects ────────────────────────────────────────────────────────────
  /** Stops early when the callback returns false, as Laravel's each() does. */
  each(fn) {
    for (let i = 0; i < this.length; i++) {
      if (fn(this[i], i) === false) break
    }
    return this
  }
  tap(fn)         { fn(this); return this }
  when(cond, fn)  { if (cond) fn(this); return this }
  unless(cond,fn) { if (!cond) fn(this); return this }

  // ─── Lazy eager loading ──────────────────────────────────────────────────────
  /** Eager-load relations onto every model in the collection, in one query each. */
  async load(...relations) {
    if (!this.length) return this
    const First = /** @type {any} */ (this[0]).constructor
    await First.query()._eagerLoad([...this], relations.flat())
    return this
  }

  /** load(), skipping relations already present on the first model. */
  async loadMissing(...relations) {
    const missing = relations.flat().filter(r => {
      const anyItem = /** @type {any} */ (this[0])
      return !anyItem?.relationLoaded?.(String(r).split('.')[0])
    })
    return missing.length ? this.load(missing) : this
  }

  // ─── Serialization ───────────────────────────────────────────────────────────
  toArray()  { return Array.from(this) }
  toJSON()   { return this.map(item => { const a = /** @type {any} */ (item); return a?.toJSON?.() ?? a }) }
  toString() { return JSON.stringify(this.toJSON()) }
}
