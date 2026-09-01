/**
 * Unit tests — @eloquentjs/mongodb connect()'s option translation.
 *
 * Mocks the `mongodb` package so no mongod is required: MongoClientOptions
 * has no top-level `username`/`password` (only a nested `auth` object), so
 * connect({ username, password }) — exactly as shown in the package's own
 * README and Configuration Reference table — used to be forwarded straight
 * through and rejected by MongoClient as "options username, password are
 * not supported".
 */

import { jest } from '@jest/globals'

let lastMongoClientArgs
class FakeMongoClient {
  constructor(url, options) {
    lastMongoClientArgs = { url, options }
  }
  async connect() {}
  db(name) { return { databaseName: name } }
  async close() {}
}

jest.unstable_mockModule('mongodb', () => ({
  MongoClient: FakeMongoClient,
  ObjectId: class ObjectId {},
}))

const { connect, disconnect } = await import('../../packages/mongodb/src/index.js')

describe('@eloquentjs/mongodb connect()', () => {
  afterEach(async () => {
    await disconnect()
  })

  test('username/password move under `auth`, not passed at the top level', async () => {
    await connect({ url: 'mongodb://localhost', database: 'app', username: 'root', password: 'secret' })
    expect(lastMongoClientArgs.options.username).toBeUndefined()
    expect(lastMongoClientArgs.options.password).toBeUndefined()
    expect(lastMongoClientArgs.options.auth).toEqual({ username: 'root', password: 'secret' })
  })

  test('authSource and other options still pass through unchanged', async () => {
    await connect({ url: 'mongodb://localhost', database: 'app', username: 'root', password: 'secret', authSource: 'admin', tls: true })
    expect(lastMongoClientArgs.options.authSource).toBe('admin')
    expect(lastMongoClientArgs.options.tls).toBe(true)
  })

  test('no auth object at all when neither username nor password is given', async () => {
    await connect({ url: 'mongodb://localhost', database: 'app' })
    expect(lastMongoClientArgs.options.auth).toBeUndefined()
  })
})
