import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Tag from '../../app/models/Tag.js'

export default class TagFactory extends Factory {
  static model = Tag

  definition() {
    return { name: faker.word.noun() }
  }
}
