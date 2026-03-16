/**
 * @eloquentjs/core — Collection
 *
 * Rich wrapper around query results. Extends Array so all native Array
 * methods still work. Collection-returning methods return new Collections.
 */
export class Collection extends Array {
  /**
   * Construct from an existing array without calling Array(n) with a number.
   * This avoids the Array(n) trap where new Array(5) creates a sparse array.
   */
  constructor(items = []) {
    super()
    if (items.length) this.push(...items)
  }

  // ─── Access ──────────────────────────────────────────────────────────────────
  first()      { return this.length > 0 ? this[0] : null }
  last()       { return this.length > 0 ? this[this.length - 1] : null }
  nth(n)       { return this[n] ?? null }
  isEmpty()    { return this.length === 0 }
  isNotEmpty() { return this.length > 0 }

  // ─── Pluck / Key ─────────────────────────────────────────────────────────────
  pluck(valueKey, keyKey = null) {
    if (keyKey) {
      const obj = {}
      for (const item of this) obj[item[keyKey]] = item[valueKey]
      return obj
    }
    return new Collection(this.map(item => item[valueKey]))
  }

  keyBy(key) {
    const result = {}
    for (const item of this) result[typeof key === 'function' ? key(item) : item[key]] = item
    return result
  }

  groupBy(key) {
    const result = {}
    for (const item of this) {
      const k = typeof key === 'function' ? key(item) : item[key]
      if (!result[k]) result[k] = new Collection()
      result[k].push(item)
    }
    return result
  }

  // ─── Filtering ───────────────────────────────────────────────────────────────
  where(key, operatorOrValue, value) {
    let operator, val
    if (value === undefined) { operator = '='; val = operatorOrValue }
    else { operator = operatorOrValue; val = value }

    return new Collection(this.filter(item => {
      const iv = typeof item.getAttribute === 'function' ? item.getAttribute(key) : item[key]
      switch (operator) {
        case '=':
        case '==':  return iv == val   // intentional loose
        case '===': return iv === val
        case '!=':
        case '<>':  return iv != val
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
    return new Collection(this.filter(item => set.has(item[key])))
  }

  whereNotIn(key, values) {
    const set = new Set(values)
    return new Collection(this.filter(item => !set.has(item[key])))
  }

  whereNull(key) {
    return new Collection(this.filter(item => item[key] == null))
  }

  whereNotNull(key) {
    return new Collection(this.filter(item => item[key] != null))
  }

  // ─── Aggregates ──────────────────────────────────────────────────────────────
  sum(key) {
    return this.reduce((acc, item) => acc + (Number(item[key]) || 0), 0)
  }
  avg(key) {
    return this.length === 0 ? 0 : this.sum(key) / this.length
  }
  min(key) {
    if (!this.length) return undefined
    return this.reduce((m, item) => (item[key] < m ? item[key] : m), this[0][key])
  }
  max(key) {
    if (!this.length) return undefined
    return this.reduce((m, item) => (item[key] > m ? item[key] : m), this[0][key])
  }
  count() { return this.length }

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
      const k = key ? (typeof key === 'function' ? key(item) : item[key]) : item
      if (seen.has(k)) return false
      seen.add(k)
      return true
    }))
  }

  chunk(size) {
    const chunks = []
    for (let i = 0; i < this.length; i += size) {
      chunks.push(new Collection(this.slice(i, i + size)))
    }
    return chunks
  }

  only(...keys) {
    const flat = keys.flat()
    return new Collection(this.map(item => {
      const out = {}
      for (const k of flat) out[k] = item[k]
      return out
    }))
  }

  except(...keys) {
    const exclude = new Set(keys.flat())
    return new Collection(this.map(item => {
      const src = item?.toJSON?.() ?? item
      const out = {}
      for (const [k, v] of Object.entries(src)) {
        if (!exclude.has(k)) out[k] = v
      }
      return out
    }))
  }

  mapInto(Klass) {
    return new Collection(this.map(item => new Klass(item?.toJSON?.() ?? item)))
  }

  flatten() {
    return new Collection(this.flat())
  }

  // ─── Side-effects ────────────────────────────────────────────────────────────
  each(fn)        { this.forEach(fn); return this }
  tap(fn)         { fn(this); return this }
  when(cond, fn)  { if (cond) fn(this); return this }
  unless(cond,fn) { if (!cond) fn(this); return this }

  // ─── Serialization ───────────────────────────────────────────────────────────
  toArray()  { return Array.from(this) }
  toJSON()   { return this.map(item => item?.toJSON?.() ?? item) }
  toString() { return JSON.stringify(this.toJSON()) }
}
