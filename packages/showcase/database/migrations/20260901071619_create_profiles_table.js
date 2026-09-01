import { Migration, Schema } from '@eloquentjs/core'

export default class CreateProfilesTable extends Migration {
  async up() {
    await Schema.create('profiles', t => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.text('bio').nullable()
      t.string('website').nullable()
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('profiles')
  }
}
