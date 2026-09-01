import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Role from '../../app/models/Role.js'

export default class RoleFactory extends Factory {
  static model = Role

  definition() {
    return { name: 'member' }
  }
}
