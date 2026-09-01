import { Seeder } from '@eloquentjs/core'
import CountryFactory from '../factories/CountryFactory.js'
import UserFactory from '../factories/UserFactory.js'
import RoleFactory from '../factories/RoleFactory.js'
import TagFactory from '../factories/TagFactory.js'
import PostFactory from '../factories/PostFactory.js'

export default class DatabaseSeeder extends Seeder {
  async run() {
    // MongoDB has no JOIN support, so belongsToMany (roles/tags) and
    // hasManyThrough (Country -> User -> Post) are unavailable there —
    // see @eloquentjs/mongodb's README "Not supported" section.
    const supportsJoins = process.env.DB_DRIVER !== 'mongodb'

    const uk = await CountryFactory.new().create({ name: 'United Kingdom' })
    const us = await CountryFactory.new().create({ name: 'United States' })

    const admin = await UserFactory.new().admin().create({ name: 'Alice Admin', email: 'alice@example.com', country_id: uk.id })
    const bob   = await UserFactory.new().create({ name: 'Bob Blogger', email: 'bob@example.com', country_id: uk.id })
    const cara  = await UserFactory.new().create({ name: 'Cara Commenter', email: 'cara@example.com', country_id: us.id })

    await admin.profile().create({ bio: 'Site administrator' })
    await bob.profile().create({ bio: 'Loves writing about JS' })

    if (supportsJoins) {
      const adminRole  = await RoleFactory.new().create({ name: 'admin' })
      const editorRole = await RoleFactory.new().create({ name: 'editor' })
      await admin.roles().attach(adminRole.id)
      await bob.roles().attach(editorRole.id)
    }

    const post1 = await bob.posts().create({ ...PostFactory.new().published().raw(), title: 'Getting started with EloquentJS' })
    const post2 = await bob.posts().create({ ...PostFactory.new().published().raw(), title: 'Relations, deep dive' })
    await bob.posts().create({ ...PostFactory.new().unpublished().raw(), title: 'Draft: upcoming features' })

    if (supportsJoins) {
      const jsTag  = await TagFactory.new().create({ name: 'javascript' })
      const ormTag = await TagFactory.new().create({ name: 'orm' })
      await post1.tags().attach([jsTag.id, ormTag.id])
      await post2.tags().attach(ormTag.id)
    }

    await cara.posts().create({ title: 'Cara has nothing to publish yet', published: false })

    await post1.comments().create({ user_id: cara.id, body: 'Great read, thanks!' })
    await post1.comments().create({ user_id: admin.id, body: 'Nice work Bob.' })

    console.log('DatabaseSeeder done.')
  }
}
