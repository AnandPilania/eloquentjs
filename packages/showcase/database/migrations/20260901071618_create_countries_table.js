import { Migration, Schema } from '@eloquentjs/core'

export default class CreateCountriesTable extends Migration {
  async up() {
    await Schema.create('countries', t => {
      t.id()
      t.string('name')
      t.timestamps()
    })
  }

  async down() {
    await Schema.dropIfExists('countries')
  }
}
