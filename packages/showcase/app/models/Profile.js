import { Model } from '@eloquentjs/core'
import User from './User.js'

export default class Profile extends Model {
  static table    = 'profiles'
  static fillable = ['user_id', 'bio', 'website']
  static hidden   = []

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
    // meta:       'json',
  }

  // ── Relations ────────────────────────────────────────────────────────
  user() { return this.belongsTo(User) }

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
