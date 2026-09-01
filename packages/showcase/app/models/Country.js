import { Model } from '@eloquentjs/core'
import User from './User.js'
import Post from './Post.js'

export default class Country extends Model {
  static table    = 'countries'
  static fillable = ['name']
  static hidden   = []

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
    // meta:       'json',
  }

  // ── Relations ────────────────────────────────────────────────────────
  users() { return this.hasMany(User) }
  posts() { return this.hasManyThrough(Post, User, 'country_id', 'user_id') }

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
