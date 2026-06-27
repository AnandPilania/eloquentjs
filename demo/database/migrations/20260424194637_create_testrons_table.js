import { Migration, Schema } from '@eloquentjs/core'

export default class CreateTestronsTable extends Migration {
    async up() {
        await Schema.create('testrons', t => {
            t.id()
            t.timestamps()
        })
    }

    async down() {
        await Schema.dropIfExists('testrons')
    }
}
