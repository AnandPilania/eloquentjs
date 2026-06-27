import { Seeder } from '@eloquentjs/core'
import TestronFactory from '../factories/TestronFactory.js'

export default class TestronSeeder extends Seeder {
  async run() {
    await TestronFactory.new().count(10).create()
    console.log('TestronSeeder done.')
  }
}
