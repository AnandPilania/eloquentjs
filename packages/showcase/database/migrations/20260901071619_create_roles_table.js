import { Migration, Schema } from '@eloquentjs/core'

export default class CreateRolesTable extends Migration {
  async up() {
    await Schema.create('roles', t => {
      t.id()
      t.string('name')
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('roles')
  }
}
