import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import Comment from '../../app/models/Comment.js'

export default class CommentFactory extends Factory {
  static model = Comment

  definition() {
    return { body: faker.lorem.sentence() }
  }
}
