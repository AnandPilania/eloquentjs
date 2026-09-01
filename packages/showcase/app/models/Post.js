import { Model } from '@eloquentjs/core'
import User from './User.js'
import Comment from './Comment.js'
import Tag from './Tag.js'

export default class Post extends Model {
  static table    = 'posts'
  static fillable = ['user_id', 'title', 'body', 'published']
  static hidden   = []
  static softDeletes = true

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    published: 'boolean',
  }

  // ── Relations ────────────────────────────────────────────────────────
  author()   { return this.belongsTo(User, 'user_id') }
  comments() { return this.hasMany(Comment) }
  tags()     { return this.belongsToMany(Tag, 'post_tag', 'post_id', 'tag_id') }

  // ── Scopes ───────────────────────────────────────────────────────────
  static scopePublished(qb) { return qb.where('published', true) }

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
