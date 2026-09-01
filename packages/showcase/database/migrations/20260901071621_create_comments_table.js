import { Migration, Schema } from '@eloquentjs/core'

export default class CreateCommentsTable extends Migration {
  async up() {
    await Schema.create('comments', t => {
      t.id()
      t.foreignId('post_id').constrained('posts').cascadeOnDelete()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.text('body')
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('comments')
  }
}
