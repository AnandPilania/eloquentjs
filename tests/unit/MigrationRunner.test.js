/**
 * @eloquentjs/cli — migration-runner.js unit tests
 *
 * Regression tests for:
 *  - a migration that throws partway through must not leave a partial
 *    record in the _migrations tracking table (transactional up()+record).
 *  - rollback/reset acquire the same concurrency lock run does, so two
 *    concurrent rollback/reset operations can't race each other.
 *
 * Uses a fully mocked "connection" (no real database) and mocks
 * '@eloquentjs/cli/utils.js' so migration-runner.js never touches a real
 * filesystem config or DB driver. Migration files themselves are real,
 * disposable files under a temp directory so `import()` can load them.
 */

import { jest } from '@jest/globals'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpDir = mkdtempSync(join(tmpdir(), 'eloq-migrations-'))

// Node resolves module format from the nearest package.json — the OS temp dir
// has none, so without this the migration files below would be parsed as CJS.
writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }))

writeFileSync(join(tmpDir, 'good.js'), `
export default class Good {
  async up() {}
  async down() {}
}
`)

writeFileSync(join(tmpDir, 'bad.js'), `
export default class Bad {
  async up() { throw new Error('boom mid-migration') }
  async down() {}
}
`)

// ─── Fake connection: tracks _migrations rows and lock/transaction calls ─────
function makeFakeConnection(initialMigrations = []) {
  const state = { migrations: [...initialMigrations] }
  const calls = { raw: [], transactions: 0 }

  const connection = {
    async raw(sql, params = []) {
      calls.raw.push(sql.trim())
      if (/GET_LOCK|pg_try_advisory_lock/.test(sql)) return [{ acquired: true }]
      if (/RELEASE_LOCK|pg_advisory_unlock/.test(sql)) return []
      if (/CREATE TABLE/.test(sql)) return []
      if (/INSERT INTO _migrations/.test(sql)) {
        state.migrations.push({ migration: params[0], batch: params[1] })
        return []
      }
      if (/DELETE FROM _migrations/.test(sql)) {
        state.migrations = state.migrations.filter(m => m.migration !== params[0])
        return []
      }
      if (/SELECT migration, batch FROM _migrations/.test(sql)) {
        return state.migrations.slice()
      }
      if (/SELECT COALESCE\(MAX\(batch\)/.test(sql)) {
        const max = state.migrations.reduce((m, r) => Math.max(m, r.batch), 0)
        return [{ next_batch: max + 1 }]
      }
      return []
    },
    async transaction(fn) {
      calls.transactions++
      const snapshot = JSON.stringify(state)
      try {
        return await fn(connection)
      } catch (err) {
        Object.assign(state, JSON.parse(snapshot))
        throw err
      }
    },
  }

  return { connection, state, calls }
}

// ─── Mock @eloquentjs/cli/utils.js so migration-runner.js needs no real
// filesystem config or DB driver — controlled per-test via mutable refs. ────
let currentConnection
let currentScan = []

jest.unstable_mockModule('../../packages/cli/src/utils.js', () => ({
  success: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  scanMigrations: jest.fn(() => currentScan),
  resolveConfig: jest.fn(() => ({ paths: { migrations: tmpDir }, connection: { driver: 'pgsql' } })),
  loadConnection: jest.fn(async () => currentConnection.connection),
  normalizeDriver: jest.fn((d) => d ?? 'pgsql'),
}))

const { runMigrations, rollbackMigrations, resetMigrations } =
  await import('../../packages/cli/src/commands/migration-runner.js')

const ctx = { cwd: '/project', config: null, flags: {}, positional: [] }

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('runMigrations — transactional up() + record', () => {
  test('a migration that throws leaves no partial record in _migrations', async () => {
    currentConnection = makeFakeConnection([])
    currentScan = [{ filename: 'bad.js', path: join(tmpDir, 'bad.js'), name: 'bad' }]

    await expect(runMigrations(ctx)).rejects.toThrow('boom mid-migration')
    expect(currentConnection.state.migrations).toHaveLength(0)
  })

  test('a successful migration is recorded, wrapped in one transaction', async () => {
    currentConnection = makeFakeConnection([])
    currentScan = [{ filename: 'good.js', path: join(tmpDir, 'good.js'), name: 'good' }]

    const result = await runMigrations(ctx)
    expect(result.ran).toBe(1)
    expect(currentConnection.state.migrations).toEqual([{ migration: 'good.js', batch: 1 }])
    expect(currentConnection.calls.transactions).toBe(1)
  })
})

describe('rollbackMigrations / resetMigrations — concurrency lock', () => {
  test('rollbackMigrations acquires the migration lock', async () => {
    currentConnection = makeFakeConnection([{ migration: 'good.js', batch: 1 }])

    await rollbackMigrations(ctx, { step: 1 })
    const lockCalls = currentConnection.calls.raw.filter(sql => /advisory_lock|GET_LOCK/.test(sql))
    expect(lockCalls.length).toBeGreaterThan(0)
    expect(currentConnection.state.migrations).toHaveLength(0)
  })

  test('resetMigrations acquires the migration lock', async () => {
    currentConnection = makeFakeConnection([{ migration: 'good.js', batch: 1 }])

    await resetMigrations(ctx)
    const lockCalls = currentConnection.calls.raw.filter(sql => /advisory_lock|GET_LOCK/.test(sql))
    expect(lockCalls.length).toBeGreaterThan(0)
    expect(currentConnection.state.migrations).toHaveLength(0)
  })
})
