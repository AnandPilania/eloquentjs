import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Post from '../../app/models/Post.js'

export default class PostFactory extends Factory {
  static model = Post

  definition() {
    return {
      title:     faker.lorem.sentence(),
      body:      faker.lorem.paragraphs(3),
      published: faker.datatype.boolean(),
    }
  }

  // States:
  published()   { return this.state({ published: true }) }
  unpublished() { return this.state({ published: false }) }
}
