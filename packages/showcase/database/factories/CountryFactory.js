import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Country from '../../app/models/Country.js'

export default class CountryFactory extends Factory {
  static model = Country

  definition() {
    return { name: faker.location.country() }
  }
}
