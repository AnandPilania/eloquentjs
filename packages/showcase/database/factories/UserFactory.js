import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import User from '../../app/models/User.js'

export default class UserFactory extends Factory {
  static model = User

  definition() {
    return {
      name:     faker.person.fullName(),
      email:    faker.internet.email(),
      password: 'password',
      is_admin: false,
    }
  }

  // States:
  admin() { return this.state({ is_admin: true }) }
}
