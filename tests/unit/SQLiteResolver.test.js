/**
 * Unit tests — SQLite SQL Builder
 */

import { SQLiteResolver, connect, disconnect, raw } from '../../packages/sqlite/src/index.js'
import { Blueprint, HookRegistry, Model, ModelRegistry, Schema, withScopes } from '../../packages/core/src/index.js'

function makeNullDb(captured = []) {
  return {
    prepare(sql) {
      captured.push(sql)
      return {
        all: (...params) => { captured.push(params); return [] },
        get: (...params) => { captured.push(params); return null },
        run: (...params) => { captured.push(params); return { changes: 1, lastInsertRowid: 1 } },
      }
    },
  }
}

describe('SQLiteResolver SQL generation', () => {
  test('uses SQLite placeholders and preserves param order', async () => {
    const resolver = new SQLiteResolver(makeNullDb())
    const { sql, params } = await resolver.toSQL('users', {
      selects: ['*'],
      wheres: [
        { column: 'active', operator: '=', value: true, boolean: 'and' },
        { type: 'between', column: 'age', min: 18, max: 65, boolean: 'and' },
      ],
      havings: [{ column: 'age', operator: '>', value: 21 }],
      groupBys: ['age'],
      limit: 10,
      offset: 20,
    })

    expect(sql).toBe('SELECT * FROM "users" WHERE "active" = ? AND "age" BETWEEN ? AND ? GROUP BY "age" HAVING "age" > ? LIMIT ? OFFSET ?')
    expect(params).toEqual([1, 18, 65, 21, 10, 20])
  })

  test('combines multiple HAVING clauses into one clause', async () => {
    const resolver = new SQLiteResolver(makeNullDb())
    const { sql, params } = await resolver.toSQL('orders', {
      selects: [{ raw: 'status, COUNT(*) AS count, SUM(total) AS total' }],
      wheres: [],
      groupBys: ['status'],
      havings: [
        { column: 'count', operator: '>', value: 1 },
        { column: 'total', operator: '<', value: 1000 },
      ],
    })

    expect(sql.match(/HAVING/g)).toHaveLength(1)
    expect(sql).toContain('HAVING "count" > ? AND "total" < ?')
    expect(params).toEqual([1, 1000])
  })

  test('generates SQLite date and JSON containment conditions', async () => {
    const resolver = new SQLiteResolver(makeNullDb())
    const { sql, params } = await resolver.toSQL('events', {
      selects: ['*'],
      wheres: [
        { type: 'year', column: 'created_at', value: 2026, boolean: 'and' },
        { type: 'jsonContains', column: 'settings', value: { theme: 'dark' }, boolean: 'and' },
      ],
    })

    expect(sql).toContain('strftime(\'%Y\', "created_at") = ?')
    expect(sql).toContain('json_extract("settings", ?) = ?')
    expect(params).toEqual(['2026', '$.theme', 'dark'])
  })

  test('creates SQLite-compatible table DDL', async () => {
    const captured = []
    const resolver = new SQLiteResolver(makeNullDb(captured))
    const bp = new Blueprint('users')
    bp.id()
    bp.string('email').unique()
    bp.boolean('active').default(true)

    await resolver.createTable('users', bp)

    expect(captured[0]).toContain('CREATE TABLE IF NOT EXISTS "users"')
    expect(captured[0]).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT')
    expect(captured[0]).toContain('"email" TEXT NOT NULL UNIQUE')
    expect(captured[0]).toContain('"active" INTEGER NOT NULL DEFAULT 1')
  })
})

describe('SQLiteResolver integration', () => {
  const connection = 'sqlite-test'

  async function seedGraph() {
    await connect({ filename: ':memory:' }, connection)

    class User extends Model {
      static table = 'users'
      static connection = connection
      static fillable = ['name', 'email', 'slug', 'active', 'country_id', 'team_id']
      static timestamps = false
      static casts = { active: 'boolean' }

      posts() { return this.hasMany(Post) }
      roles() { return this.belongsToMany(Role, 'role_user', 'user_id', 'role_id') }
      static scopeNamed(qb, name) { return qb.where('name', name) }
      static scopeActive(qb) { return qb.where('active', true) }
    }

    class Post extends Model {
      static table = 'posts'
      static connection = connection
      static fillable = ['user_id', 'title', 'deleted_at']
      static timestamps = false
      static softDeletes = true

      user() { return this.belongsTo(User) }
      comments() { return this.hasMany(Comment) }
      static scopeTitled(qb, title) { return qb.where('title', title) }
    }

    class Comment extends Model {
      static table = 'comments'
      static connection = connection
      static fillable = ['post_id', 'author_id', 'body']
      static timestamps = false

      post() { return this.belongsTo(Post) }
      author() { return this.belongsTo(User, 'author_id') }
    }

    class Role extends Model {
      static table = 'roles'
      static connection = connection
      static fillable = ['name']
      static timestamps = false
    }

    class Photo extends Model {
      static table = 'photos'
      static connection = connection
      static fillable = ['url', 'imageable_type', 'imageable_id']
      static timestamps = false

      imageable() { return this.morphTo('imageable') }
    }

    class Video extends Model {
      static table = 'videos'
      static connection = connection
      static fillable = ['title']
      static timestamps = false

      photos() { return this.morphMany(Photo, 'imageable') }
    }

    class UserProfile extends Model {
      static table = 'user_profiles'
      static connection = connection
      static fillable = ['user_id', 'bio']
      static timestamps = false

      user() { return this.belongsTo(User) }
    }

    class Country extends Model {
      static table = 'countries'
      static connection = connection
      static fillable = ['name']
      static timestamps = false
      users() { return this.hasMany(User) }
    }

    class Team extends Model {
      static table = 'teams'
      static connection = connection
      static fillable = ['name']
      static timestamps = false

      members() { return this.hasMany(User, 'team_id') }
    }

    class Deployment extends Model {
      static table = 'deployments'
      static connection = connection
      static fillable = ['user_id', 'version']
      static timestamps = false
    }

    Team.prototype.deployments = function () { return this.hasManyThrough(Deployment, User, 'team_id', 'user_id') }

    User.prototype.profilePhoto = function () { return this.morphOne(Photo, 'imageable') }
    User.prototype.photos = function () { return this.morphMany(Photo, 'imageable') }
    User.prototype.country = function () { return this.belongsTo(Country) }

    ModelRegistry.register(User)
    ModelRegistry.register(Post)
    ModelRegistry.register(Photo)
    ModelRegistry.register(Video)

    await Schema.create('users', table => {
      table.id()
      table.string('name')
      table.string('email').unique()
      table.string('slug').nullable()
      table.boolean('active').default(true)
      table.unsignedBigInteger('country_id').nullable()
      table.unsignedBigInteger('team_id').nullable()
    }, connection)

    await Schema.create('countries', table => {
      table.id()
      table.string('name').unique()
    }, connection)

    await Schema.create('teams', table => {
      table.id()
      table.string('name').unique()
    }, connection)

    await Schema.create('posts', table => {
      table.id()
      table.string('title')
      table.foreignId('user_id').constrained('users').cascadeOnDelete()
      table.softDeletes()
    }, connection)

    await Schema.create('comments', table => {
      table.id()
      table.text('body')
      table.foreignId('post_id').constrained('posts').cascadeOnDelete()
      table.foreignId('author_id').constrained('users').cascadeOnDelete()
    }, connection)

    await Schema.create('roles', table => {
      table.id()
      table.string('name').unique()
    }, connection)

    await Schema.create('videos', table => {
      table.id()
      table.string('title')
    }, connection)

    await Schema.create('photos', table => {
      table.id()
      table.string('url')
      table.string('imageable_type')
      table.unsignedBigInteger('imageable_id')
    }, connection)

    await Schema.create('user_profiles', table => {
      table.id()
      table.foreignId('user_id').constrained('users').cascadeOnDelete()
      table.text('bio').nullable()
    }, connection)

    await Schema.create('deployments', table => {
      table.id()
      table.string('version')
      table.foreignId('user_id').constrained('users').cascadeOnDelete()
    }, connection)

    await Schema.create('role_user', table => {
      table.string('label').nullable()
      table.foreignId('user_id').constrained('users').cascadeOnDelete()
      table.foreignId('role_id').constrained('roles').cascadeOnDelete()
      table.unique(['user_id', 'role_id'])
    }, connection)

    const observerCalls = []
    HookRegistry.observe(User, {
      creating(model) {
        observerCalls.push(`creating:${model.name}`)
        model.slug = model.name.toLowerCase().replace(/\s+/g, '-')
      },
      created(model) {
        observerCalls.push(`created:${model.slug}`)
      },
    })

    const [usa, canada, alphaTeam, betaTeam] = await Promise.all([
      Country.create({ name: 'USA' }),
      Country.create({ name: 'Canada' }),
      Team.create({ name: 'Alpha' }),
      Team.create({ name: 'Beta' }),
    ])

    const [alice, bob, carol] = await Promise.all([
      User.create({ name: 'Alice Admin', email: 'alice@example.com', active: true, country_id: usa.id, team_id: alphaTeam.id }),
      User.create({ name: 'Bob Builder', email: 'bob@example.com', active: false, country_id: usa.id, team_id: alphaTeam.id }),
      User.create({ name: 'Carol Creator', email: 'carol@example.com', active: true, country_id: canada.id, team_id: betaTeam.id }),
    ])

    await alice.posts().createMany([
      { title: 'Alice post 1' },
      { title: 'Alice post 2' },
    ])
    await bob.posts().create({ title: 'Bob post 1' })
    await carol.posts().create({ title: 'Carol post 1' })

    const [alicePost1, alicePost2, bobPost1, carolPost1] = await Promise.all([
      Post.where('title', 'Alice post 1').firstOrFail(),
      Post.where('title', 'Alice post 2').firstOrFail(),
      Post.where('title', 'Bob post 1').firstOrFail(),
      Post.where('title', 'Carol post 1').firstOrFail(),
    ])

    await Comment.create({ post_id: alicePost1.id, author_id: bob.id, body: 'Bob on Alice 1' })
    await Comment.create({ post_id: alicePost1.id, author_id: carol.id, body: 'Carol on Alice 1' })
    await Comment.create({ post_id: alicePost2.id, author_id: alice.id, body: 'Alice on Alice 2' })
    await Comment.create({ post_id: bobPost1.id, author_id: alice.id, body: 'Alice on Bob 1' })
    await Comment.create({ post_id: carolPost1.id, author_id: bob.id, body: 'Bob on Carol 1' })

    await Deployment.create({ user_id: alice.id, version: '1.0.0' })
    await Deployment.create({ user_id: bob.id, version: '1.1.0' })
    await Deployment.create({ user_id: carol.id, version: '2.0.0' })

    const [adminRole, editorRole] = await Promise.all([
      Role.create({ name: 'admin' }),
      Role.create({ name: 'editor' }),
    ])

    await alice.roles().withPivot('label').attach(adminRole.id, { label: 'owner' })
    await alice.roles().withPivot('label').attach(editorRole.id, { label: 'writer' })
    await bob.roles().attach(editorRole.id, { label: 'reviewer' })

    const [introVideo] = await Promise.all([
      Video.create({ title: 'Intro Video' }),
      UserProfile.create({ user_id: alice.id, bio: 'Alice bio' }),
    ])

    await alice.profilePhoto().create({ url: 'https://img.test/alice-profile.jpg' })
    await bob.photos().create({ url: 'https://img.test/bob-1.jpg' })
    await introVideo.photos().create({ url: 'https://img.test/video-1.jpg' })

    return {
      User,
      Post,
      Comment,
      Role,
      Photo,
      Video,
      UserProfile,
      Country,
      Team,
      Deployment,
      alice,
      bob,
      carol,
      usa,
      canada,
      alphaTeam,
      betaTeam,
      adminRole,
      editorRole,
      introVideo,
      observerCalls,
    }
  }

  afterEach(async () => {
    HookRegistry.flushAll()
    await disconnect(connection)
  })

  test('runs model CRUD against an in-memory SQLite database', async () => {
    await connect({ filename: ':memory:' }, connection)

    class User extends Model {
      static table = 'users'
      static connection = connection
      static casts = { active: 'boolean', settings: 'json' }
    }

    await Schema.create('users', table => {
      table.id()
      table.string('email').unique()
      table.boolean('active').default(true)
      table.json('settings').nullable()
      table.timestamps()
    }, connection)

    await User.create({ email: 'a@example.com', active: true, settings: { theme: 'dark', locale: 'en' } })

    const user = await User.where('email', 'a@example.com').firstOrFail()
    expect(user.email).toBe('a@example.com')
    expect(user.active).toBe(true)
    expect(user.settings).toEqual({ theme: 'dark', locale: 'en' })

    const matching = await User.whereJsonContains('settings', { theme: 'dark' }).count()
    expect(matching).toBe(1)
  })

  test('accepts PostgreSQL-style placeholders in raw SQLite calls', async () => {
    await connect({ filename: ':memory:' }, connection)
    await raw('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)', [], connection)
    await raw('INSERT INTO items (name) VALUES ($1)', ['desk'], connection)

    const rows = await raw('SELECT name FROM items WHERE name = $1', ['desk'], connection)
    expect(rows).toEqual([{ name: 'desk' }])
  })

  test('adds and drops foreign keys by rebuilding the table', async () => {
    await connect({ filename: ':memory:' }, connection)

    await Schema.create('users', table => {
      table.id()
      table.string('email')
    }, connection)

    await Schema.create('posts', table => {
      table.id()
      table.unsignedBigInteger('user_id')
      table.string('title')
    }, connection)

    await raw('INSERT INTO users (email) VALUES ($1)', ['a@example.com'], connection)
    await raw('INSERT INTO posts (user_id, title) VALUES ($1, $2)', [1, 'valid'], connection)

    await Schema.table('posts', table => {
      table.foreign('user_id').references('id').on('users').onDelete('CASCADE')
    }, connection)

    await expect(
      raw('INSERT INTO posts (user_id, title) VALUES ($1, $2)', [999, 'invalid'], connection)
    ).rejects.toThrow()

    await Schema.table('posts', table => {
      table.dropForeign('posts_user_id_foreign')
    }, connection)

    await raw('INSERT INTO posts (user_id, title) VALUES ($1, $2)', [999, 'allowed'], connection)
    const rows = await raw('SELECT title FROM posts ORDER BY id', [], connection)
    expect(rows.map(row => row.title)).toEqual(['valid', 'allowed'])
  })

  test('drops and renames columns by rebuilding while preserving data', async () => {
    await connect({ filename: ':memory:' }, connection)

    await Schema.create('posts', table => {
      table.id()
      table.string('title')
      table.string('body').nullable()
      table.string('draft_notes').nullable()
    }, connection)

    await raw(
      'INSERT INTO posts (title, body, draft_notes) VALUES ($1, $2, $3)',
      ['Original title', 'Body text', 'remove me'],
      connection
    )

    await Schema.table('posts', table => {
      table.renameColumn('title', 'headline')
      table.dropColumn('draft_notes')
    }, connection)

    const columns = await Schema.getColumnListing('posts', connection)
    expect(columns).toEqual(['id', 'headline', 'body'])

    const rows = await raw('SELECT headline, body FROM posts', [], connection)
    expect(rows).toEqual([{ headline: 'Original title', body: 'Body text' }])
  })

  test('adds and drops unique constraints through rebuilds', async () => {
    await connect({ filename: ':memory:' }, connection)

    await Schema.create('users', table => {
      table.id()
      table.string('email').unique()
      table.string('name')
    }, connection)

    await raw('INSERT INTO users (email, name) VALUES ($1, $2)', ['a@example.com', 'A'], connection)
    await expect(
      raw('INSERT INTO users (email, name) VALUES ($1, $2)', ['a@example.com', 'Duplicate'], connection)
    ).rejects.toThrow()

    await Schema.table('users', table => {
      table.dropUnique('users_email_unique')
      table.string('slug').nullable().unique()
    }, connection)

    await raw('INSERT INTO users (email, name, slug) VALUES ($1, $2, $3)', ['a@example.com', 'Allowed', 'same'], connection)
    await expect(
      raw('INSERT INTO users (email, name, slug) VALUES ($1, $2, $3)', ['b@example.com', 'Slug duplicate', 'same'], connection)
    ).rejects.toThrow()

    const rows = await raw('SELECT email, name FROM users ORDER BY id', [], connection)
    expect(rows).toEqual([
      { email: 'a@example.com', name: 'A' },
      { email: 'a@example.com', name: 'Allowed' },
    ])
  })

  test('observer hooks run during model creation', async () => {
    const { alice, observerCalls } = await seedGraph()

    expect(alice.slug).toBe('alice-admin')
    expect(observerCalls).toContain('creating:Alice Admin')
    expect(observerCalls).toContain('created:alice-admin')
  })

  test('pagination returns meta and eager-loaded relationships', async () => {
    const { User } = await seedGraph()

    const paginated = await User.orderBy('name').with('posts', 'roles').paginate(1, 2)
    expect(paginated.meta).toEqual({
      total: 3,
      per_page: 2,
      current_page: 1,
      last_page: 2,
      from: 1,
      to: 2,
      has_more: true,
    })
    expect(paginated.data).toHaveLength(2)
    expect(paginated.data[0].relationLoaded('posts')).toBe(true)
    expect(paginated.data[0].relationLoaded('roles')).toBe(true)
    expect(paginated.data[0].posts).toHaveLength(2)
    expect(paginated.data[0].roles).toHaveLength(2)
    expect(paginated.data[0].roles[0]._pivot).toBeDefined()
  })

  test('belongsTo eager loading loads parent relations', async () => {
    const { Post } = await seedGraph()

    const eagerPost = await Post.with('user').where('title', 'Alice post 1').firstOrFail()
    expect(eagerPost.relationLoaded('user')).toBe(true)
    expect(eagerPost.user.email).toBe('alice@example.com')
  })

  test('hasManyThrough loads related records through the intermediate model', async () => {
    const { Team, alphaTeam, betaTeam } = await seedGraph()

    const alpha = await Team.findOrFail(alphaTeam.id)
    const beta = await Team.findOrFail(betaTeam.id)

    const alphaDeployments = await alpha.deployments().get()
    const betaDeployments = await beta.deployments().get()

    expect(alphaDeployments.map(deployment => deployment.version).sort()).toEqual([
      '1.0.0',
      '1.1.0',
    ])
    expect(betaDeployments.map(deployment => deployment.version)).toEqual(['2.0.0'])
  })

  test('soft deletes exclude trashed models by default', async () => {
    const { Post } = await seedGraph()

    const trashed = await Post.where('title', 'Alice post 2').firstOrFail()
    await trashed.delete()

    const visiblePosts = await Post.orderBy('title').get()
    expect(visiblePosts.map(post => post.title)).toEqual([
      'Alice post 1',
      'Bob post 1',
      'Carol post 1',
    ])

    const onlyTrashed = await Post.onlyTrashed().orderBy('title').get()
    expect(onlyTrashed.map(post => post.title)).toEqual(['Alice post 2'])
  })

  test('eager loading can include soft-deleted relations with withTrashed()', async () => {
    const { User, Post } = await seedGraph()

    const trashed = await Post.where('title', 'Alice post 2').firstOrFail()
    await trashed.delete()

    const defaultUsers = await User.with('posts').orderBy('name').get()
    expect(defaultUsers[0].posts.map(post => post.title)).toEqual(['Alice post 1'])

    const withTrashedUsers = await User.with({
      posts: qb => qb.withTrashed().orderBy('title'),
    }).orderBy('name').get()

    expect(withTrashedUsers[0].posts.map(post => post.title)).toEqual([
      'Alice post 1',
      'Alice post 2',
    ])
  })

  test('belongsToMany returns pivot attributes and sync updates pivots', async () => {
    const { alice, bob, adminRole } = await seedGraph()

    const aliceRoles = await alice.roles().withPivot('label').orderBy('name').get()
    expect(aliceRoles.map(role => role.name)).toEqual(['admin', 'editor'])
    expect(aliceRoles.map(role => role._pivot.label)).toEqual(['owner', 'writer'])

    await bob.roles().sync([adminRole.id])
    const bobRoles = await bob.roles().get()
    expect(bobRoles.map(role => role.name)).toEqual(['admin'])
  })

  test('belongsToMany detach removes a specific pivot row', async () => {
    const { alice, editorRole } = await seedGraph()

    await alice.roles().detach(editorRole.id)

    const roles = await alice.roles().orderBy('name').get()
    expect(roles.map(role => role.name)).toEqual(['admin'])
  })

  test('belongsToMany toggle detaches existing ids and attaches missing ids', async () => {
    const { alice, bob, adminRole, editorRole } = await seedGraph()

    await alice.roles().toggle([adminRole.id, editorRole.id])
    let aliceRoles = await alice.roles().get()
    expect(aliceRoles).toHaveLength(0)

    await bob.roles().toggle([adminRole.id, editorRole.id])
    const bobRoles = await bob.roles().orderBy('name').get()
    expect(bobRoles.map(role => role.name)).toEqual(['admin'])
  })

  test('belongsToMany updateExistingPivot updates pivot attributes in place', async () => {
    const { alice, adminRole } = await seedGraph()

    await alice.roles().updateExistingPivot(adminRole.id, { label: 'super-owner' })

    const roles = await alice.roles().withPivot('label').orderBy('name').get()
    expect(roles[0].name).toBe('admin')
    expect(roles[0]._pivot.label).toBe('super-owner')
  })

  test('nested eager loading loads User.with("posts.comments.author")', async () => {
    const { User } = await seedGraph()

    const resolver = User.getResolver()
    const originalSelect = resolver.select.bind(resolver)
    const selectCalls = []

    resolver.select = async (table, ctx) => {
      selectCalls.push({ table, ctx })
      return originalSelect(table, ctx)
    }

    try {
      const users = await User.orderBy('name').with('posts.comments.author').get()
      const alice = users[0]

      expect(alice.relationLoaded('posts')).toBe(true)
      expect(alice.posts[0].relationLoaded('comments')).toBe(true)
      expect(alice.posts[0].comments[0].relationLoaded('author')).toBe(true)
      expect(alice.posts[0].comments[0].author.name).toBe('Bob Builder')
      expect(alice.posts[1].comments[0].author.name).toBe('Alice Admin')

      expect(selectCalls.map(call => call.table)).toEqual(['users', 'posts', 'comments', 'users'])
      expect(selectCalls).toHaveLength(4)
    } finally {
      resolver.select = originalSelect
    }
  })

  test('eager loading constraints can use scoped query helpers', async () => {
    const { User, Post } = await seedGraph()

    const scopedUsers = await User.with({
      posts: qb => Post.scopeTitled(qb, 'Alice post 1'),
    }).orderBy('name').get()

    expect(scopedUsers[0].posts).toHaveLength(1)
    expect(scopedUsers[0].posts[0].title).toBe('Alice post 1')
    expect(scopedUsers[1].posts).toHaveLength(0)
    expect(scopedUsers[2].posts).toHaveLength(0)
  })

  test('constrained eager loading supports nested relations in the callback', async () => {
    const { User, Post } = await seedGraph()

    const users = await User.with({
      posts: qb => Post.scopeTitled(qb, 'Alice post 1').with('comments.author'),
    }).orderBy('name').get()

    expect(users[0].posts).toHaveLength(1)
    expect(users[0].posts[0].relationLoaded('comments')).toBe(true)
    expect(users[0].posts[0].comments[0].relationLoaded('author')).toBe(true)
    expect(users[0].posts[0].comments[0].author.name).toBe('Bob Builder')
    expect(users[1].posts).toHaveLength(0)
    expect(users[2].posts).toHaveLength(0)
  })

  test('model scopes work directly through withScopes proxies', async () => {
    const { User, Post } = await seedGraph()

    const ScopedUser = withScopes(User)
    const ScopedPost = withScopes(Post)

    const namedUser = await ScopedUser.named('Alice Admin').firstOrFail()
    const titledPost = await ScopedPost.titled('Bob post 1').firstOrFail()

    expect(namedUser.email).toBe('alice@example.com')
    expect(titledPost.title).toBe('Bob post 1')
  })

  test('conventional scopeActive works through withScopes proxies', async () => {
    const { User } = await seedGraph()
    const ScopedUser = withScopes(User)

    const { sql, params } = await ScopedUser.active().orderBy('name').toSQL()

    const activeUsers = await ScopedUser.active().orderBy('name').get()

    expect(sql).toContain('WHERE "active" = ?')
    expect(params).toContain(1)
    expect(activeUsers.map(user => user.name)).toEqual([
      'Alice Admin',
      'Carol Creator',
    ])
    expect(activeUsers.every(user => user.active)).toBe(true)
  })

  test('polymorphic relations support morphMany, morphOne, and morphTo eager loading', async () => {
    const { User, Photo, Video, alice, bob, introVideo } = await seedGraph()

    const users = await User.orderBy('name').with('photos').get()
    expect(users[0].photos).toHaveLength(1)
    expect(users[1].photos).toHaveLength(1)
    expect(users[2].photos).toHaveLength(0)

    const aliceWithProfile = await User.with('profilePhoto').where('id', alice.id).firstOrFail()
    expect(aliceWithProfile.relationLoaded('profilePhoto')).toBe(true)
    expect(aliceWithProfile.profilePhoto.url).toContain('alice-profile')

    const photos = await Photo.orderBy('id').with('imageable').get()
    expect(photos[0].imageable.name).toBe('Alice Admin')
    expect(photos[1].imageable.name).toBe('Bob Builder')
    expect(photos[2].imageable.title).toBe('Intro Video')

    const video = await Video.with('photos').where('id', introVideo.id).firstOrFail()
    expect(video.photos).toHaveLength(1)
    expect(video.photos[0].url).toContain('video-1')
  })

  test('nested eager loading works through morphTo targets', async () => {
    const { Photo } = await seedGraph()

    const photos = await Photo.orderBy('id').with('imageable.posts').get()

    expect(photos[0].imageable.name).toBe('Alice Admin')
    expect(photos[0].imageable.relationLoaded('posts')).toBe(true)
    expect(photos[0].imageable.posts.map(post => post.title)).toEqual([
      'Alice post 1',
      'Alice post 2',
    ])

    expect(photos[1].imageable.name).toBe('Bob Builder')
    expect(photos[1].imageable.relationLoaded('posts')).toBe(true)
    expect(photos[1].imageable.posts.map(post => post.title)).toEqual(['Bob post 1'])

    expect(photos[2].imageable.title).toBe('Intro Video')
  })

  test('paginate works with constrained eager-loaded relations', async () => {
    const { User, Post } = await seedGraph()

    const paginated = await User.orderBy('name').with({
      posts: qb => Post.scopeTitled(qb, 'Alice post 1'),
    }).paginate(1, 2)

    expect(paginated.meta.total).toBe(3)
    expect(paginated.data).toHaveLength(2)
    expect(paginated.data[0].posts).toHaveLength(1)
    expect(paginated.data[0].posts[0].title).toBe('Alice post 1')
    expect(paginated.data[1].posts).toHaveLength(0)
  })

  test('whereJsonContains supports array values', async () => {
    await connect({ filename: ':memory:' }, connection)

    class FeatureFlag extends Model {
      static table = 'feature_flags'
      static connection = connection
      static fillable = ['name', 'tags']
      static timestamps = false
      static casts = { tags: 'json' }
    }

    await Schema.create('feature_flags', table => {
      table.id()
      table.string('name')
      table.json('tags').nullable()
    }, connection)

    await FeatureFlag.create({ name: 'dark-mode', tags: ['ui', 'beta'] })
    await FeatureFlag.create({ name: 'search', tags: ['backend'] })

    const matches = await FeatureFlag.whereJsonContains('tags', ['ui', 'beta']).get()
    expect(matches.map(flag => flag.name)).toEqual(['dark-mode'])
  })

  test('observer hooks run during update and delete lifecycle', async () => {
    const { User, alice } = await seedGraph()

    const observerCalls = []
    HookRegistry.observe(User, {
      updating(model) { observerCalls.push(`updating:${model.id}`) },
      updated(model) { observerCalls.push(`updated:${model.id}`) },
      deleting(model) { observerCalls.push(`deleting:${model.id}`) },
      deleted(model) { observerCalls.push(`deleted:${model.id}`) },
    })

    const user = await User.findOrFail(alice.id)
    user.name = 'Alice Updated'
    await user.save()
    await user.delete()

    expect(observerCalls).toEqual([
      `updating:${alice.id}`,
      `updated:${alice.id}`,
      `deleting:${alice.id}`,
      `deleted:${alice.id}`,
    ])
  })

  test('multiple named SQLite connections stay isolated and can be replaced', async () => {
    const primary = 'sqlite-primary'
    const secondary = 'sqlite-secondary'

    try {
      await connect({ filename: ':memory:' }, primary)
      await connect({ filename: ':memory:' }, secondary)

      class PrimaryNote extends Model {
        static table = 'notes'
        static connection = primary
        static fillable = ['body']
        static timestamps = false
      }

      class SecondaryNote extends Model {
        static table = 'notes'
        static connection = secondary
        static fillable = ['body']
        static timestamps = false
      }

      await Schema.create('notes', table => {
        table.id()
        table.string('body')
      }, primary)

      await Schema.create('notes', table => {
        table.id()
        table.string('body')
      }, secondary)

      await PrimaryNote.create({ body: 'primary-note' })
      await SecondaryNote.create({ body: 'secondary-note' })

      expect((await PrimaryNote.all()).map(note => note.body)).toEqual(['primary-note'])
      expect((await SecondaryNote.all()).map(note => note.body)).toEqual(['secondary-note'])

      await connect({ filename: ':memory:' }, primary)
      await Schema.create('notes', table => {
        table.id()
        table.string('body')
      }, primary)

      expect(await PrimaryNote.count()).toBe(0)
      expect(await SecondaryNote.count()).toBe(1)
    } finally {
      await disconnect(primary)
      await disconnect(secondary)
    }
  })

  test('eager loading roles and polymorphic photos use batched queries', async () => {
    const { User } = await seedGraph()
    const resolver = User.getResolver()
    const originalSelect = resolver.select.bind(resolver)
    const originalSelectPivotMany = resolver.selectPivotMany.bind(resolver)
    const selectCalls = []
    const pivotCalls = []

    resolver.select = async (table, ctx) => {
      selectCalls.push({ table, ctx })
      return originalSelect(table, ctx)
    }
    resolver.selectPivotMany = async (args) => {
      pivotCalls.push(args)
      return originalSelectPivotMany(args)
    }

    try {
      const users = await User.orderBy('name').with('roles', 'photos').get()

      expect(users).toHaveLength(3)
      expect(selectCalls.map(call => call.table)).toEqual(['users', 'photos'])
      expect(pivotCalls).toHaveLength(1)
      expect(pivotCalls[0].foreignIds).toHaveLength(3)
    } finally {
      resolver.select = originalSelect
      resolver.selectPivotMany = originalSelectPivotMany
    }
  })

  test('SQLite rebuild preserves defaults, indexes, uniques, and foreign keys', async () => {
    await connect({ filename: ':memory:' }, connection)

    await Schema.create('parents', table => {
      table.id()
      table.string('name').unique()
    }, connection)

    await Schema.create('children', table => {
      table.id()
      table.foreignId('parent_id').constrained('parents').cascadeOnDelete()
      table.string('code').unique()
      table.boolean('is_active').default(true)
      table.index('parent_id')
    }, connection)

    await raw('INSERT INTO parents (name) VALUES ($1)', ['parent-1'], connection)
    await raw('INSERT INTO children (parent_id, code) VALUES ($1, $2)', [1, 'child-1'], connection)

    await Schema.table('children', table => {
      table.renameColumn('code', 'external_code')
      table.string('status').default('draft')
    }, connection)

    const columns = await Schema.getColumnListing('children', connection)
    expect(columns).toEqual(['id', 'parent_id', 'external_code', 'is_active', 'status'])

    const rows = await raw('SELECT parent_id, external_code, is_active, status FROM children', [], connection)
    expect(rows).toEqual([{ parent_id: 1, external_code: 'child-1', is_active: 1, status: 'draft' }])

    await expect(
      raw('INSERT INTO children (parent_id, external_code) VALUES ($1, $2)', [999, 'child-2'], connection)
    ).rejects.toThrow()

    await expect(
      raw('INSERT INTO children (parent_id, external_code) VALUES ($1, $2)', [1, 'child-1'], connection)
    ).rejects.toThrow()
  })

  test('dropPrimary rebuild preserves data for non-rowid primary keys', async () => {
    await connect({ filename: ':memory:' }, connection)

    await Schema.create('legacy_keys', table => {
      table.string('code')
      table.string('value')
      table.primary('code')
    }, connection)

    await raw('INSERT INTO legacy_keys (code, value) VALUES ($1, $2)', ['A1', 'alpha'], connection)

    await Schema.table('legacy_keys', table => {
      table.dropPrimary()
    }, connection)

    const rows = await raw('SELECT code, value FROM legacy_keys', [], connection)
    expect(rows).toEqual([{ code: 'A1', value: 'alpha' }])

    await raw('INSERT INTO legacy_keys (code, value) VALUES ($1, $2)', ['A1', 'duplicate'], connection)
    const duplicates = await raw('SELECT code, value FROM legacy_keys WHERE code = $1 ORDER BY value', ['A1'], connection)
    expect(duplicates).toEqual([
      { code: 'A1', value: 'alpha' },
      { code: 'A1', value: 'duplicate' },
    ])
  })

  test('scope methods can be used in eager-load constraints with nested loads', async () => {
    const { User, Post } = await seedGraph()

    const users = await User.with({
      posts: qb => Post.scopeTitled(qb, 'Alice post 2'),
    }).orderBy('name').get()

    expect(users[0].posts).toHaveLength(1)
    expect(users[0].posts[0].title).toBe('Alice post 2')
    expect(users[1].posts).toHaveLength(0)
  })
})
