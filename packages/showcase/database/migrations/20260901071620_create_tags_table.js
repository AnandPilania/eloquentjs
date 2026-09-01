import { Migration, Schema } from '@eloquentjs/core'

export default class CreateTagsTable extends Migration {
  async up() {
    await Schema.create('tags', t => {
      t.id()
      t.string('name').unique()
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('tags')
  }
}
