import { Migration, Schema } from '@eloquentjs/core'

export default class CreatePostTagTable extends Migration {
  async up() {
    await Schema.create('post_tag', t => {
      t.id()
      t.foreignId('post_id').constrained('posts').cascadeOnDelete()
      t.foreignId('tag_id').constrained('tags').cascadeOnDelete()
      t.unique(['post_id', 'tag_id'])
    })
  }

  async down() {
    await Schema.dropIfExists('post_tag')
  }
}
