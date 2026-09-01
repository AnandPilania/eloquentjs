import { Migration, Schema } from '@eloquentjs/core'

export default class CreateRoleUserTable extends Migration {
  async up() {
    await Schema.create('role_user', t => {
      t.id()
      t.foreignId('user_id').constrained('users').cascadeOnDelete()
      t.foreignId('role_id').constrained('roles').cascadeOnDelete()
      t.timestamp('assigned_at').nullable()
      t.unique(['user_id', 'role_id'])
    })
  }

  async down() {
    await Schema.dropIfExists('role_user')
  }
}
