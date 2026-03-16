/**
 * @eloquentjs/core — Relations
 *
 * Relation objects are returned from model methods.
 * They are lazy (call .get() or await them) and support eager loading.
 *
 * Key design: eagerLoad() receives the relation name from the QueryBuilder
 * (i.e. the method name the user called with `.with('posts')`) and uses
 * THAT name to setRelation(), not an inferred name from the Related model.
 */

import { Collection } from '../Collection.js'

function inferForeignKey(ModelClass) {
  const snake = ModelClass.name
    .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
    .replace(/^_/, '')
  return `${snake}_id`
}

function getResolver(ModelClass) {
  // Import lazily to avoid circular dep at module load time
  return ModelClass.getResolver()
}

// ─── HasOne ──────────────────────────────────────────────────────────────────
class HasOne {
  constructor(parent, Related, foreignKey, localKey) {
    this._parent     = parent
    this._Related    = Related
    this._foreignKey = foreignKey ?? inferForeignKey(parent.constructor)
    this._localKey   = localKey   ?? parent.constructor.primaryKey
  }

  async get() {
    return this._Related
      .where(this._foreignKey, this._parent.getAttribute(this._localKey))
      .first()
  }

  async create(attrs = {}) {
    return this._Related.create({
      ...attrs,
      [this._foreignKey]: this._parent.getAttribute(this._localKey),
    })
  }

  async save(model) {
    model.setAttribute(this._foreignKey, this._parent.getAttribute(this._localKey))
    return model.save()
  }

  async eagerLoad(models, relName, constraints, nested) {
    const localKey   = this._localKey
    const foreignKey = this._foreignKey
    const ids        = models.map(m => m.getAttribute(localKey))

    let qb = this._Related.whereIn(foreignKey, ids)
    if (constraints) constraints(qb)
    if (nested) qb = qb.with(nested)

    const results = await qb.get()

    // Index results by foreignKey
    const map = {}
    for (const r of results) map[r.getAttribute(foreignKey)] = r

    for (const model of models) {
      model.setRelation(relName, map[model.getAttribute(localKey)] ?? null)
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── HasMany ─────────────────────────────────────────────────────────────────
class HasMany {
  constructor(parent, Related, foreignKey, localKey) {
    this._parent     = parent
    this._Related    = Related
    this._foreignKey = foreignKey ?? inferForeignKey(parent.constructor)
    this._localKey   = localKey   ?? parent.constructor.primaryKey
    this._constraints = []
  }

  _qb() {
    const qb = this._Related.where(
      this._foreignKey,
      this._parent.getAttribute(this._localKey)
    )
    for (const fn of this._constraints) fn(qb)
    return qb
  }

  // Chainable constraint methods (for lazy load customisation)
  where(...a)    { this._constraints.push(qb => qb.where(...a));    return this }
  orderBy(...a)  { this._constraints.push(qb => qb.orderBy(...a));  return this }
  limit(n)       { this._constraints.push(qb => qb.limit(n));       return this }
  with(...a)     { this._constraints.push(qb => qb.with(...a));     return this }

  async get()    { return this._qb().get() }
  async count()  { return this._qb().count() }
  async first()  { return this._qb().first() }
  async exists() { return this._qb().exists() }

  async create(attrs = {}) {
    return this._Related.create({
      ...attrs,
      [this._foreignKey]: this._parent.getAttribute(this._localKey),
    })
  }

  async createMany(rows = []) {
    return Promise.all(rows.map(r => this.create(r)))
  }

  async save(model) {
    model.setAttribute(this._foreignKey, this._parent.getAttribute(this._localKey))
    return model.save()
  }

  async saveMany(models) {
    return Promise.all(models.map(m => this.save(m)))
  }

  async eagerLoad(models, relName, constraints, nested) {
    const localKey   = this._localKey
    const foreignKey = this._foreignKey
    const ids        = models.map(m => m.getAttribute(localKey))

    let qb = this._Related.whereIn(foreignKey, ids)
    if (constraints) constraints(qb)
    if (nested) qb = qb.with(nested)

    const results = await qb.get()

    // Index results by foreignKey (one-to-many)
    const map = {}
    for (const r of results) {
      const fk = r.getAttribute(foreignKey)
      if (!map[fk]) map[fk] = []
      map[fk].push(r)
    }

    for (const model of models) {
      model.setRelation(relName, new Collection(map[model.getAttribute(localKey)] ?? []))
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── BelongsTo ───────────────────────────────────────────────────────────────
class BelongsTo {
  constructor(parent, Related, foreignKey, ownerKey) {
    this._parent     = parent
    this._Related    = Related
    this._foreignKey = foreignKey ?? inferForeignKey(Related)
    this._ownerKey   = ownerKey   ?? Related.primaryKey
  }

  async get() {
    const fkVal = this._parent.getAttribute(this._foreignKey)
    if (fkVal == null) return null
    return this._Related.where(this._ownerKey, fkVal).first()
  }

  async associate(model) {
    this._parent.setAttribute(this._foreignKey, model.getAttribute(this._ownerKey))
    return this._parent.save()
  }

  async dissociate() {
    this._parent.setAttribute(this._foreignKey, null)
    return this._parent.save()
  }

  async eagerLoad(models, relName, constraints, nested) {
    const foreignKey = this._foreignKey
    const ownerKey   = this._ownerKey
    const ids        = [...new Set(models.map(m => m.getAttribute(foreignKey)).filter(v => v != null))]

    if (!ids.length) {
      for (const m of models) m.setRelation(relName, null)
      return
    }

    let qb = this._Related.whereIn(ownerKey, ids)
    if (constraints) constraints(qb)
    if (nested) qb = qb.with(nested)

    const results = await qb.get()
    const map = {}
    for (const r of results) map[r.getAttribute(ownerKey)] = r

    for (const model of models) {
      model.setRelation(relName, map[model.getAttribute(foreignKey)] ?? null)
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── BelongsToMany ───────────────────────────────────────────────────────────
class BelongsToMany {
  constructor(parent, Related, pivotTable, foreignKey, relatedKey) {
    const parentSnake  = parent.constructor.name.replace(/([A-Z])/g, m => `_${m.toLowerCase()}`).replace(/^_/, '')
    const relatedSnake = Related.name.replace(/([A-Z])/g, m => `_${m.toLowerCase()}`).replace(/^_/, '')

    this._parent      = parent
    this._Related     = Related
    this._pivotTable  = pivotTable  ?? [parentSnake, relatedSnake].sort().join('_')
    this._foreignKey  = foreignKey  ?? `${parentSnake}_id`
    this._relatedKey  = relatedKey  ?? `${relatedSnake}_id`
    this._pivotCols   = []
    this._constraints = []
  }

  withPivot(...cols) {
    this._pivotCols.push(...cols.flat())
    return this
  }

  orderBy(...a)  { this._constraints.push(qb => qb.orderBy(...a));  return this }
  where(...a)    { this._constraints.push(qb => qb.where(...a));    return this }
  limit(n)       { this._constraints.push(qb => qb.limit(n));       return this }

  async get() {
    const parentId  = this._parent.getAttribute(this._parent.constructor.primaryKey)
    const resolver  = getResolver(this._Related)
    const rows = await resolver.selectPivot({
      mainTable:       this._Related.getTable(),
      pivotTable:      this._pivotTable,
      mainKey:         this._Related.primaryKey,
      pivotForeignKey: this._foreignKey,
      pivotRelatedKey: this._relatedKey,
      foreignId:       parentId,
      pivotColumns:    this._pivotCols,
    })
    return new Collection(rows.map(({ _pivot, ...attrs }) => {
      const model = this._Related._hydrate(attrs)
      model._pivot = _pivot ?? {}
      return model
    }))
  }

  async attach(id, pivotAttrs = {}) {
    const parentId = this._parent.getAttribute(this._parent.constructor.primaryKey)
    const ids = Array.isArray(id) ? id : [id]
    const resolver = getResolver(this._Related)
    for (const relId of ids) {
      await resolver.insert(this._pivotTable, {
        [this._foreignKey]: parentId,
        [this._relatedKey]: relId,
        ...pivotAttrs,
      })
    }
  }

  async detach(id) {
    const parentId = this._parent.getAttribute(this._parent.constructor.primaryKey)
    const cond = { [this._foreignKey]: parentId }
    if (id !== undefined) cond[this._relatedKey] = id
    await getResolver(this._Related).delete(this._pivotTable, cond)
  }

  async sync(ids, detaching = true) {
    const current = (await this.get()).map(m => m.getAttribute(this._Related.primaryKey))
    const incoming = Array.isArray(ids) ? ids : Object.keys(ids)

    const toAttach = incoming.filter(id => !current.includes(id))
    const toDetach = detaching ? current.filter(id => !incoming.includes(id)) : []

    for (const id of toDetach) await this.detach(id)
    for (const id of toAttach) {
      const extra = Array.isArray(ids) ? {} : ids[id]
      await this.attach(id, extra ?? {})
    }
  }

  async toggle(id) {
    const current = (await this.get()).map(m => m.getAttribute(this._Related.primaryKey))
    const ids = Array.isArray(id) ? id : [id]
    for (const i of ids) {
      if (current.includes(i)) await this.detach(i)
      else await this.attach(i)
    }
  }

  async updateExistingPivot(id, attrs) {
    const parentId = this._parent.getAttribute(this._parent.constructor.primaryKey)
    await getResolver(this._Related).update(
      this._pivotTable,
      { [this._foreignKey]: parentId, [this._relatedKey]: id },
      attrs
    )
  }

  async count()  { return (await this.get()).length }
  async exists() { return (await this.count()) > 0 }

  async eagerLoad(models, relName, constraints, nested) {
    const resolver  = getResolver(this._Related)
    const parentIds = models.map(m => m.getAttribute(m.constructor.primaryKey))

    const rows = await resolver.selectPivotMany({
      mainTable:       this._Related.getTable(),
      pivotTable:      this._pivotTable,
      mainKey:         this._Related.primaryKey,
      pivotForeignKey: this._foreignKey,
      pivotRelatedKey: this._relatedKey,
      foreignIds:      parentIds,
      pivotColumns:    this._pivotCols,
    })

    const map = {}
    for (const { _pivot_foreign_id, _pivot, ...attrs } of rows) {
      const model = this._Related._hydrate(attrs)
      model._pivot = _pivot ?? {}
      if (!map[_pivot_foreign_id]) map[_pivot_foreign_id] = []
      map[_pivot_foreign_id].push(model)
    }

    for (const model of models) {
      const parentId = model.getAttribute(model.constructor.primaryKey)
      model.setRelation(relName, new Collection(map[parentId] ?? []))
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── HasManyThrough ──────────────────────────────────────────────────────────
class HasManyThrough {
  constructor(parent, Related, Through, firstKey, secondKey, localKey, throughKey) {
    this._parent    = parent
    this._Related   = Related
    this._Through   = Through
    this._firstKey  = firstKey  ?? inferForeignKey(parent.constructor)  // through.parent_id
    this._secondKey = secondKey ?? inferForeignKey(Through)             // related.through_id
    this._localKey  = localKey  ?? parent.constructor.primaryKey
    this._throughKey= throughKey ?? Through.primaryKey
  }

  async get() {
    const parentId = this._parent.getAttribute(this._localKey)
    const rows = await getResolver(this._Related).hasManyThrough({
      relatedTable:  this._Related.getTable(),
      throughTable:  this._Through.getTable(),
      firstKey:      this._firstKey,
      secondKey:     this._secondKey,
      throughKey:    this._throughKey,
      parentId,
    })
    return new Collection(rows.map(r => this._Related._hydrate(r)))
  }

  async eagerLoad(models, relName, constraints, nested) {
    const resolver  = getResolver(this._Related)
    const localKey  = this._localKey
    const ids       = models.map(m => m.getAttribute(localKey))

    const rows = await resolver.hasManyThroughMany({
      relatedTable:  this._Related.getTable(),
      throughTable:  this._Through.getTable(),
      firstKey:      this._firstKey,
      secondKey:     this._secondKey,
      throughKey:    this._throughKey,
      parentIds:     ids,
    })

    const map = {}
    for (const { _parent_id, ...rest } of rows) {
      if (!map[_parent_id]) map[_parent_id] = []
      map[_parent_id].push(this._Related._hydrate(rest))
    }

    for (const model of models) {
      model.setRelation(relName, new Collection(map[model.getAttribute(localKey)] ?? []))
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── MorphOne / MorphMany ────────────────────────────────────────────────────
class MorphMany {
  constructor(parent, Related, morphName) {
    this._parent   = parent
    this._Related  = Related
    this._typeCol  = `${morphName}_type`
    this._idCol    = `${morphName}_id`
    this._morphName = morphName
  }

  _qb() {
    return this._Related
      .where(this._typeCol, this._parent.constructor.name)
      .where(this._idCol,   this._parent.getAttribute(this._parent.constructor.primaryKey))
  }

  async get()   { return this._qb().get() }
  async count() { return this._qb().count() }

  async create(attrs = {}) {
    return this._Related.create({
      ...attrs,
      [this._typeCol]: this._parent.constructor.name,
      [this._idCol]:   this._parent.getAttribute(this._parent.constructor.primaryKey),
    })
  }

  async eagerLoad(models, relName, constraints, nested) {
    const typeCols = this._typeCol
    const idCols   = this._idCol
    const morphType = this._parent.constructor.name
    const ids       = models.map(m => m.getAttribute(m.constructor.primaryKey))

    let qb = this._Related.where(typeCols, morphType).whereIn(idCols, ids)
    if (constraints) constraints(qb)
    if (nested) qb = qb.with(nested)

    const results = await qb.get()
    const map = {}
    for (const r of results) {
      const k = r.getAttribute(idCols)
      if (!map[k]) map[k] = []
      map[k].push(r)
    }

    for (const model of models) {
      const pk = model.getAttribute(model.constructor.primaryKey)
      model.setRelation(relName, new Collection(map[pk] ?? []))
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

class MorphOne {
  constructor(parent, Related, morphName) {
    this._parent   = parent
    this._Related  = Related
    this._typeCol  = `${morphName}_type`
    this._idCol    = `${morphName}_id`
  }

  _qb() {
    return this._Related
      .where(this._typeCol, this._parent.constructor.name)
      .where(this._idCol,   this._parent.getAttribute(this._parent.constructor.primaryKey))
  }

  async get()   { return this._qb().first() }

  async create(attrs = {}) {
    return this._Related.create({
      ...attrs,
      [this._typeCol]: this._parent.constructor.name,
      [this._idCol]:   this._parent.getAttribute(this._parent.constructor.primaryKey),
    })
  }

  async eagerLoad(models, relName, constraints, nested) {
    const typeCols  = this._typeCol
    const idCols    = this._idCol
    const morphType = this._parent.constructor.name
    const ids       = models.map(m => m.getAttribute(m.constructor.primaryKey))

    let qb = this._Related.where(typeCols, morphType).whereIn(idCols, ids)
    if (constraints) constraints(qb)

    const results = await qb.get()
    const map = {}
    for (const r of results) map[r.getAttribute(idCols)] = r

    for (const model of models) {
      const pk = model.getAttribute(model.constructor.primaryKey)
      model.setRelation(relName, map[pk] ?? null)
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── MorphTo (inverse) ───────────────────────────────────────────────────────
const _morphMap = new Map()

class MorphTo {
  constructor(parent, morphName) {
    this._parent   = parent
    this._typeCol  = `${morphName}_type`
    this._idCol    = `${morphName}_id`
  }

  async get() {
    const type = this._parent.getAttribute(this._typeCol)
    const id   = this._parent.getAttribute(this._idCol)
    if (!type || id == null) return null
    const Related = _morphMap.get(type)
    if (!Related) throw new Error(`[EloquentJS] MorphTo: no model registered for morph type "${type}". Call ModelRegistry.register(YourModel)`)
    return Related.find(id)
  }

  async eagerLoad(models, relName, constraints) {
    // Group models by morph type
    const groups = {}
    for (const m of models) {
      const type = m.getAttribute(this._typeCol)
      if (!type) { m.setRelation(relName, null); continue }
      if (!groups[type]) groups[type] = []
      groups[type].push(m)
    }

    for (const [type, group] of Object.entries(groups)) {
      const Related = _morphMap.get(type)
      if (!Related) { for (const m of group) m.setRelation(relName, null); continue }

      const ids = group.map(m => m.getAttribute(this._idCol))
      const results = await Related.whereIn(Related.primaryKey, ids).get()
      const map = {}
      for (const r of results) map[r.getAttribute(Related.primaryKey)] = r

      for (const model of group) {
        model.setRelation(relName, map[model.getAttribute(this._idCol)] ?? null)
      }
    }
  }

  then(res, rej) { return this.get().then(res, rej) }
}

// ─── Registry ─────────────────────────────────────────────────────────────────
export const ModelRegistry = {
  register(ModelClass) { _morphMap.set(ModelClass.name, ModelClass) },
  get(name)            { return _morphMap.get(name) },
  all()                { return new Map(_morphMap) },
}

export const RelationRegistry = {
  hasOne:         (p, R, fk, lk)       => new HasOne(p, R, fk, lk),
  hasMany:        (p, R, fk, lk)       => new HasMany(p, R, fk, lk),
  belongsTo:      (p, R, fk, ok)       => new BelongsTo(p, R, fk, ok),
  belongsToMany:  (p, R, pt, fk, rk)   => new BelongsToMany(p, R, pt, fk, rk),
  hasManyThrough: (p, R, T, fk1, fk2)  => new HasManyThrough(p, R, T, fk1, fk2),
  morphOne:       (p, R, name)         => new MorphOne(p, R, name),
  morphMany:      (p, R, name)         => new MorphMany(p, R, name),
  morphTo:        (p, name)            => new MorphTo(p, name),
}
