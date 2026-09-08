/**
 * Unit tests — @eloquentjs/pgsql connect()'s pool option translation.
 *
 * Mocks the `pg` package so no real Postgres is required. Regression test for
 * connect() reading `config.poolSize` instead of the documented `config.max`,
 * and never reading `config.min` at all.
 */

import { jest } from '@jest/globals'

let lastPoolConfig
class FakeClient {
  async query() { return { rows: [{ '?column?': 1 }] } }
  release() {}
}
class FakePool {
  constructor(config) { lastPoolConfig = config }
  async connect() { return new FakeClient() }
  async query() { return { rows: [], rowCount: 0 } }
  async end() {}
}

jest.unstable_mockModule('pg', () => ({
  default: {
    Pool: FakePool,
    types: { builtins: { INT8: 20, NUMERIC: 1700 }, getTypeParser: () => (v) => v },
  },
}))

const { connect, disconnect } = await import('../../packages/pgsql/src/index.js')

describe('@eloquentjs/pgsql connect()', () => {
  afterEach(async () => {
    await disconnect()
  })

  test('config.max sets the pool max size', async () => {
    await connect({ max: 5 })
    expect(lastPoolConfig.max).toBe(5)
  })

  test('config.poolSize still works for back-compat', async () => {
    await connect({ poolSize: 7 })
    expect(lastPoolConfig.max).toBe(7)
  })

  test('config.max takes precedence over config.poolSize', async () => {
    await connect({ max: 3, poolSize: 20 })
    expect(lastPoolConfig.max).toBe(3)
  })

  test('defaults to 10 when neither is given', async () => {
    await connect({})
    expect(lastPoolConfig.max).toBe(10)
  })

  test('config.min is passed through to the pool config', async () => {
    await connect({ min: 2 })
    expect(lastPoolConfig.min).toBe(2)
  })

  test('min is omitted when not given', async () => {
    await connect({})
    expect(lastPoolConfig.min).toBeUndefined()
  })
})
