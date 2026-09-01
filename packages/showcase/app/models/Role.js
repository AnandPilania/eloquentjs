import { Model } from '@eloquentjs/core'
import User from './User.js'

export default class Role extends Model {
  static table    = 'roles'
  static fillable = ['name']
  static hidden   = []

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
    // meta:       'json',
  }

  // ── Relations ────────────────────────────────────────────────────────
  users() { return this.belongsToMany(User, 'role_user', 'role_id', 'user_id') }

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
