import { Seeder } from '@eloquentjs/core'

export default class DatabaseSeeder extends Seeder {
  async run() {
    // Call your seeders here:
    // await this.call(UserSeeder, PostSeeder)
    console.log('Database seeded.')
  }
}
