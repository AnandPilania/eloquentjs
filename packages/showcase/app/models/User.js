import { Model } from '@eloquentjs/core'
import Post from './Post.js'
import Profile from './Profile.js'
import Role from './Role.js'
import Country from './Country.js'

export default class User extends Model {
  static table    = 'users'
  static fillable = ['name', 'email', 'password', 'country_id', 'is_admin']
  static hidden   = ['password']
  static softDeletes = true

  // ── Casts ────────────────────────────────────────────────────────────
  static casts = {
    is_admin: 'boolean',
  }

  // ── Relations ────────────────────────────────────────────────────────
  posts()   { return this.hasMany(Post) }
  profile() { return this.hasOne(Profile) }
  roles()   { return this.belongsToMany(Role, 'role_user', 'user_id', 'role_id') }
  country() { return this.belongsTo(Country) }

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
