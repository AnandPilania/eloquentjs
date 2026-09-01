import { Model } from '@eloquentjs/core'
import Post from './Post.js'
import User from './User.js'

export default class Comment extends Model {
  static table    = 'comments'
  static fillable = ['post_id', 'user_id', 'body']
  static hidden   = []

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    // created_at: 'date',
    // is_active:  'boolean',
    // meta:       'json',
  }

  // ── Relations ────────────────────────────────────────────────────────
  post()   { return this.belongsTo(Post) }
  author() { return this.belongsTo(User, 'user_id') }

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
