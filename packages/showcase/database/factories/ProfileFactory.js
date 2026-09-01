import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Profile from '../../app/models/Profile.js'

export default class ProfileFactory extends Factory {
  static model = Profile

  definition() {
    return {
      bio:     faker.lorem.sentence(),
      website: faker.internet.url(),
    }
  }
}
