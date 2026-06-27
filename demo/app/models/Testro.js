import { Model } from '@eloquentjs/core'

export default class Testro extends Model {
  static table    = 'testros'
  static fillable = []
  static hidden   = []

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
    // meta:       'json',
  }

  // ── Relations ────────────────────────────────────────────────────────
  // posts()   { return this.hasMany(Post) }
  // profile() { return this.hasOne(Profile) }

  // ── Scopes ───────────────────────────────────────────────────────────
  // static scopeActive(qb) { return qb.where('active', true) }

  // ── Accessors / Mutators ─────────────────────────────────────────────
  // getFullNameAttribute() { return `${this.first_name} ${this.last_name}` }
  // setPasswordAttribute(v) { return bcrypt.hashSync(v, 10) }

  // ── Lifecycle Hooks ──────────────────────────────────────────────────
  // static async creating(record) { }
  // static async created(record)  { }
  // static async updating(record) { }
  // static async updated(record)  { }
  // static async deleting(record) { }
  // static async deleted(record)  { }
}
