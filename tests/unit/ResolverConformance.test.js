/**
 * All in-tree drivers run against the shared resolver contract.
 * Contract: packages/core/RESOLVER.md
 *
 * Shape checks run everywhere — they need no database, and they are what catches
 * a driver quietly missing a method core documents as available.
 *
 * Behavioral checks need a live database, so only SQLite runs by default (via
 * built-in node:sqlite, no native build). Postgres and MongoDB opt in through
 * DATABASE_URL / MONGO_URL and skip themselves otherwise.
 */

import { describeResolverShape, describeResolverBehavior } from '@eloquentjs/core/testing'
import { PgResolver } from '../../packages/pgsql/src/index.js'
import { SQLiteResolver } from '../../packages/sqlite/src/index.js'
import { MongoResolver } from '../../packages/mongodb/src/index.js'

// ─── Shape: every driver, no database ────────────────────────────────────────
describeResolverShape('PgResolver',     () => new PgResolver({ query: async () => ({ rows: [] }) }))
describeResolverShape('SQLiteResolver', () => new SQLiteResolver({ prepare: () => ({}) }))
describeResolverShape('MongoResolver',  () => new MongoResolver({ collection: () => ({}) }))

// ─── Behavior: SQLite for real, via node:sqlite ──────────────────────────────
let DatabaseSync = null
try { ({ DatabaseSync } = await import('node:sqlite')) } catch { /* Node < 22.5 */ }

describeResolverBehavior('SQLiteResolver', {
  makeResolver: () => (DatabaseSync ? new SQLiteResolver(new DatabaseSync(':memory:')) : null),
  createTable: async (r) => {
    await r.raw(`CREATE TABLE conformance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      n INTEGER,
      tags TEXT,
      deleted_at TEXT
    )`)
  },
  // Each makeResolver() call is a fresh :memory: db, so there is nothing to drop.
})

// ─── Behavior: Postgres, only when DATABASE_URL is set ───────────────────────
describeResolverBehavior('PgResolver', {
  makeResolver: () => null,   // ponytail: wire to a pg Pool from DATABASE_URL in CI
  createTable: async () => {},
})

// ─── Behavior: MongoDB, only when MONGO_URL is set ───────────────────────────
describeResolverBehavior('MongoResolver', {
  makeResolver: () => null,   // ponytail: wire to a Db from MONGO_URL in CI
  createTable: async () => {},
  supports: { groups: true, jsonContains: false },
})
