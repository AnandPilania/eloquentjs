import { Migration, Schema } from '@eloquentjs/core'

export default class CreatePostsTable extends Migration {
  async up() {
    await Schema.create('posts', t => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.string('title')
      t.text('body').nullable()
      t.boolean('published').default(false)
      t.timestamps()
      t.softDeletes()
    })
  }

  async down() {
    await Schema.dropIfExists('posts')
  }
}
