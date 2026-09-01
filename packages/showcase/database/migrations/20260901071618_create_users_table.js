import { Migration, Schema } from '@eloquentjs/core'

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create('users', t => {
      t.id()
      t.string('name')
      t.string('email').unique()
      t.string('password')
      t.boolean('is_admin').default(false)
      t.foreignId('country_id').nullable().constrained('countries').nullOnDelete()
      t.timestamps()
      t.softDeletes()
    })
  }

  async down() {
    await Schema.dropIfExists('users')
  }
}
