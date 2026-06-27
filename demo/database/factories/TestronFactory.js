import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Testron from '../models/Testron.js'

export default class TestronFactory extends Factory {
  model = Testron

  definition() {
    return {
      //
    }
  }

  // States:
  // admin() { return this.state({ is_admin: true }) }
}
