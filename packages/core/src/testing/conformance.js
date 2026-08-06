/// <reference types="jest" />
/**
 * @eloquentjs/core — Resolver conformance suite
 *
 * Shared tests every driver should pass. The contract they enforce is written
 * out in packages/core/RESOLVER.md.
 *
 *   import { describeResolverShape, describeResolverBehavior } from '@eloquentjs/core/testing'
 *
 * Two tiers, because most drivers cannot be exercised without a server:
 *
 *   describeResolverShape     — no database. Checks the interface is complete.
 *   describeResolverBehavior  — needs a live database. Checks it behaves.
 *
 * Uses the ambient Jest globals (describe/test/expect); the repo has one runner
 * and abstracting over it would cost more than it buys.
 */

/**
 * Required: core calls these unguarded, so a driver without them is broken.
 * Keep in sync with RESOLVER.md and the ModelResolver typedef in Model.js —
 * those three used to disagree about which methods were optional.
 */
export const REQUIRED_METHODS = [
  // reads
  'select',
  // writes
  'insert', 'update', 'delete', 'truncate',
]

/**
 * Optional: core checks for these and raises a clear error when they are
 * missing, so a store that genuinely cannot support one may omit it.
 * Every driver in this repo implements all of them except where noted.
 */
export const OPTIONAL_METHODS = [
  'raw', 'transaction',
  'aggregate', 'toSQL', 'insertMany', 'increment', 'upsert',
  'selectPivot', 'selectPivotMany', 'hasManyThrough', 'hasManyThroughMany',
  'createTable', 'alterTable', 'dropTable', 'renameTable',
  'hasTable', 'hasColumn', 'getColumnListing',
]

/**
 * Methods the drivers shipped in this repo are all expected to provide.
 * Distinct from REQUIRED_METHODS: a third-party resolver may skip these,
 * but ours must not regress.
 */
export const EXPECTED_METHODS = [...REQUIRED_METHODS, ...OPTIONAL_METHODS.filter(m => m !== 'upsert')]

/** Minimum arity core relies on, where a resolver cannot get away with fewer. */
const MIN_ARITY = {
  select: 2, aggregate: 4, toSQL: 2,
  insert: 2, insertMany: 2, update: 3, delete: 2, increment: 5, truncate: 1,
  createTable: 2, alterTable: 2, dropTable: 1, renameTable: 2,
  hasTable: 1, hasColumn: 2, getColumnListing: 1,
  transaction: 1,
}

/**
 * Interface completeness. Needs only something `new`-able — pass a fake
 * connection; nothing is executed.
 *
 * @param {string}   name          driver name, for test output
 * @param {Function} makeResolver  () => resolver
 */
export function describeResolverShape(name, makeResolver) {
  describe(`${name} — resolver contract (shape)`, () => {
    let resolver
    beforeAll(() => { resolver = makeResolver() })

    test('is constructible', () => {
      expect(resolver).toBeTruthy()
    })

    test.each(REQUIRED_METHODS)('implements %s() (required)', (method) => {
      expect(typeof resolver[method]).toBe('function')
    })

    test.each(EXPECTED_METHODS)('implements %s()', (method) => {
      expect(typeof resolver[method]).toBe('function')
    })

    test.each(EXPECTED_METHODS)('%s() is async', (method) => {
      // Everything core awaits must return a promise, or error handling and
      // transaction ordering break in ways that only show up under load.
      expect(resolver[method].constructor.name).toBe('AsyncFunction')
    })

    test('declares enough parameters to honour its callers', () => {
      const tooFew = Object.entries(MIN_ARITY)
        .filter(([m, n]) => typeof resolver[m] === 'function' && resolver[m].length < n)
        .map(([m, n]) => `${m}() takes ${resolver[m].length}, core passes ${n}`)
      expect(tooFew).toEqual([])
    })

    test('any optional method it does provide is also async', () => {
      for (const m of OPTIONAL_METHODS) {
        if (typeof resolver[m] === 'function') {
          expect(resolver[m].constructor.name).toBe('AsyncFunction')
        }
      }
    })
  })
}

/**
 * Behavioural conformance against a real database.
 *
 * @param {string} name
 * @param {object} opts
 * @param {Function} opts.makeResolver  () => resolver | null — null skips the suite
 * @param {Function} opts.createTable   async (resolver) => void — must create
 *        a `conformance` table with: id (auto pk), name (text), n (int),
 *        tags (text/json, nullable), deleted_at (nullable)
 * @param {Function} [opts.dropTable]   async (resolver) => void
 * @param {object}   [opts.supports]    { groups, jsonContains } — default true
 */
export function describeResolverBehavior(name, {
  makeResolver,
  createTable,
  dropTable = null,
  supports = {},
}) {
  const can = { groups: true, jsonContains: true, ...supports }

  let resolver = null
  try { resolver = makeResolver() } catch { resolver = null }

  const d = resolver ? describe : describe.skip

  d(`${name} — resolver contract (behavior)`, () => {
    const TABLE = 'conformance'
    const ctx = (over = {}) => ({ selects: ['*'], wheres: [], ...over })
    const names = (rows) => rows.map(r => r.name).sort()

    beforeEach(async () => {
      resolver = makeResolver()
      if (dropTable) await dropTable(resolver).catch(() => {})
      await createTable(resolver)
      await resolver.insertMany(TABLE, [
        { name: 'alpha', n: 10 },
        { name: 'beta',  n: 20 },
        { name: 'gamma', n: 30 },
      ])
    })

    afterEach(async () => {
      if (dropTable) await dropTable(resolver).catch(() => {})
    })

    describe('select', () => {
      test('no wheres returns every row', async () => {
        expect(names(await resolver.select(TABLE, ctx()))).toEqual(['alpha', 'beta', 'gamma'])
      })

      test('equality where', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'beta', boolean: 'and' }],
        }))
        expect(names(rows)).toEqual(['beta'])
      })

      test('two ANDed wheres', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [
            { column: 'n', operator: '>', value: 5, boolean: 'and' },
            { column: 'n', operator: '<', value: 25, boolean: 'and' },
          ],
        }))
        expect(names(rows)).toEqual(['alpha', 'beta'])
      })

      test('OR widens the result', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [
            { column: 'name', operator: '=', value: 'alpha', boolean: 'and' },
            { column: 'name', operator: '=', value: 'gamma', boolean: 'or' },
          ],
        }))
        expect(names(rows)).toEqual(['alpha', 'gamma'])
      })

      test('OR splits runs — a OR (b AND c)', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [
            { column: 'name', operator: '=', value: 'alpha', boolean: 'and' },
            { column: 'n', operator: '>', value: 15, boolean: 'or' },
            { column: 'n', operator: '<', value: 25, boolean: 'and' },
          ],
        }))
        expect(names(rows)).toEqual(['alpha', 'beta'])
      })

      test('in / notIn', async () => {
        expect(names(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'in', column: 'name', values: ['alpha', 'beta'], boolean: 'and' }],
        })))).toEqual(['alpha', 'beta'])

        expect(names(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'notIn', column: 'name', values: ['alpha'], boolean: 'and' }],
        })))).toEqual(['beta', 'gamma'])
      })

      test('an empty in matches nothing; an empty notIn matches everything', async () => {
        expect(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'in', column: 'name', values: [], boolean: 'and' }],
        }))).toHaveLength(0)

        expect(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'notIn', column: 'name', values: [], boolean: 'and' }],
        }))).toHaveLength(3)
      })

      test('null / notNull', async () => {
        expect(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'notNull', column: 'deleted_at', boolean: 'and' }],
        }))).toHaveLength(0)

        expect(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'null', column: 'deleted_at', boolean: 'and' }],
        }))).toHaveLength(3)
      })

      test('between / notBetween are inclusive', async () => {
        expect(names(await resolver.select(TABLE, ctx({
          wheres: [{ type: 'between', column: 'n', min: 10, max: 20, boolean: 'and' }],
        })))).toEqual(['alpha', 'beta'])
      })

      test('limit and offset', async () => {
        const rows = await resolver.select(TABLE, ctx({
          orderBys: [{ column: 'n', direction: 'ASC' }], limit: 1, offset: 1,
        }))
        expect(names(rows)).toEqual(['beta'])
      })

      test('orderBy DESC', async () => {
        const rows = await resolver.select(TABLE, ctx({ orderBys: [{ column: 'n', direction: 'DESC' }] }))
        expect(rows.map(r => r.name)).toEqual(['gamma', 'beta', 'alpha'])
      })

      test('selects narrows the columns', async () => {
        const rows = await resolver.select(TABLE, ctx({ selects: ['name'] }))
        expect(Object.keys(rows[0])).toContain('name')
        expect(Object.keys(rows[0])).not.toContain('n')
      })
    })

    ;(can.groups ? describe : describe.skip)('nested groups', () => {
      test('a group is parenthesized, so a scope cannot be OR-ed away', async () => {
        // The soft-delete leak: flat, this returns rows the scope excluded.
        const rows = await resolver.select(TABLE, ctx({
          wheres: [
            { type: 'null', column: 'deleted_at', boolean: 'and', _scope: '_softDelete' },
            { type: 'group', boolean: 'and', wheres: [
              { column: 'name', operator: '=', value: 'alpha', boolean: 'and' },
              { column: 'name', operator: '=', value: 'gamma', boolean: 'or' },
            ] },
          ],
        }))
        expect(names(rows)).toEqual(['alpha', 'gamma'])
      })

      test('a group narrows rather than widens', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [
            { column: 'n', operator: '>', value: 15, boolean: 'and' },
            { type: 'group', boolean: 'and', wheres: [
              { column: 'name', operator: '=', value: 'beta', boolean: 'and' },
              { column: 'name', operator: '=', value: 'alpha', boolean: 'or' },
            ] },
          ],
        }))
        expect(names(rows)).toEqual(['beta'])
      })

      test('groups nest', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ type: 'group', boolean: 'and', wheres: [
            { column: 'n', operator: '=', value: 30, boolean: 'and' },
            { type: 'group', boolean: 'or', wheres: [
              { column: 'name', operator: '=', value: 'alpha', boolean: 'and' },
              { column: 'n', operator: '=', value: 10, boolean: 'and' },
            ] },
          ] }],
        }))
        expect(names(rows)).toEqual(['alpha', 'gamma'])
      })

      test('an empty group contributes no clause', async () => {
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ type: 'group', boolean: 'and', wheres: [] }],
        }))
        expect(rows).toHaveLength(3)
      })
    })

    describe('aggregate', () => {
      test('count', async () => {
        expect(Number(await resolver.aggregate(TABLE, 'count', '*', ctx()))).toBe(3)
      })

      test('count honours wheres', async () => {
        const n = await resolver.aggregate(TABLE, 'count', '*', ctx({
          wheres: [{ column: 'n', operator: '>', value: 15, boolean: 'and' }],
        }))
        expect(Number(n)).toBe(2)
      })

      test('sum / min / max / avg', async () => {
        expect(Number(await resolver.aggregate(TABLE, 'sum', 'n', ctx()))).toBe(60)
        expect(Number(await resolver.aggregate(TABLE, 'min', 'n', ctx()))).toBe(10)
        expect(Number(await resolver.aggregate(TABLE, 'max', 'n', ctx()))).toBe(30)
        expect(Number(await resolver.aggregate(TABLE, 'avg', 'n', ctx()))).toBe(20)
      })

      test('count of an empty match is 0, not null', async () => {
        const n = await resolver.aggregate(TABLE, 'count', '*', ctx({
          wheres: [{ column: 'name', operator: '=', value: 'nope', boolean: 'and' }],
        }))
        expect(Number(n)).toBe(0)
      })
    })

    describe('insert', () => {
      test('returns the row with its generated key', async () => {
        const row = await resolver.insert(TABLE, { name: 'delta', n: 40 })
        expect(row).toBeTruthy()
        expect(row.name).toBe('delta')
        expect(row.id ?? row._id ?? row.insertedId).toBeTruthy()
      })

      test('the row is actually persisted', async () => {
        await resolver.insert(TABLE, { name: 'delta', n: 40 })
        expect(Number(await resolver.aggregate(TABLE, 'count', '*', ctx()))).toBe(4)
      })
    })

    describe('insertMany', () => {
      test('inserts every row', async () => {
        await resolver.insertMany(TABLE, [{ name: 'd', n: 40 }, { name: 'e', n: 50 }])
        expect(Number(await resolver.aggregate(TABLE, 'count', '*', ctx()))).toBe(5)
      })

      test('returns one entry per row', async () => {
        const rows = await resolver.insertMany(TABLE, [{ name: 'd', n: 40 }, { name: 'e', n: 50 }])
        expect(rows).toHaveLength(2)
      })

      test('heterogeneous rows: missing keys become NULL', async () => {
        await resolver.insertMany(TABLE, [{ name: 'd' }, { name: 'e', n: 50 }])
        const [d] = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'd', boolean: 'and' }],
        }))
        expect(d.n == null).toBe(true)
      })

      test('empty input touches nothing', async () => {
        expect(await resolver.insertMany(TABLE, [])).toEqual([])
        expect(Number(await resolver.aggregate(TABLE, 'count', '*', ctx()))).toBe(3)
      })
    })

    describe('update', () => {
      test('by conditions object', async () => {
        await resolver.update(TABLE, { name: 'alpha' }, { n: 99 })
        const [row] = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        expect(Number(row.n)).toBe(99)
      })

      test('by ctx, in bulk', async () => {
        await resolver.update(TABLE, null, { n: 0 }, ctx({
          wheres: [{ column: 'n', operator: '>', value: 15, boolean: 'and' }],
        }))
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'n', operator: '=', value: 0, boolean: 'and' }],
        }))
        expect(names(rows)).toEqual(['beta', 'gamma'])
      })

      test('a ctx update respects a group', async () => {
        if (!can.groups) return
        await resolver.update(TABLE, null, { n: 0 }, ctx({
          wheres: [{ type: 'group', boolean: 'and', wheres: [
            { column: 'name', operator: '=', value: 'alpha', boolean: 'and' },
            { column: 'name', operator: '=', value: 'beta', boolean: 'or' },
          ] }],
        }))
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'n', operator: '=', value: 0, boolean: 'and' }],
        }))
        expect(names(rows)).toEqual(['alpha', 'beta'])
      })
    })

    describe('delete', () => {
      test('by conditions object', async () => {
        await resolver.delete(TABLE, { name: 'alpha' })
        expect(names(await resolver.select(TABLE, ctx()))).toEqual(['beta', 'gamma'])
      })

      test('by ctx', async () => {
        await resolver.delete(TABLE, null, ctx({
          wheres: [{ column: 'n', operator: '>', value: 15, boolean: 'and' }],
        }))
        expect(names(await resolver.select(TABLE, ctx()))).toEqual(['alpha'])
      })
    })

    describe('increment', () => {
      test('adds to a column', async () => {
        await resolver.increment(TABLE, 'n', 5, {}, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        const [row] = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        expect(Number(row.n)).toBe(15)
      })

      test('a negative amount decrements', async () => {
        await resolver.increment(TABLE, 'n', -5, {}, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        const [row] = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        expect(Number(row.n)).toBe(5)
      })

      test('extra columns are set in the same statement', async () => {
        await resolver.increment(TABLE, 'n', 1, { name: 'renamed' }, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        const rows = await resolver.select(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'renamed', boolean: 'and' }],
        }))
        expect(rows).toHaveLength(1)
        expect(Number(rows[0].n)).toBe(11)
      })
    })

    describe('truncate', () => {
      test('removes every row', async () => {
        await resolver.truncate(TABLE)
        expect(await resolver.select(TABLE, ctx())).toHaveLength(0)
      })
    })

    describe('toSQL', () => {
      test('returns a description without executing', async () => {
        const out = await resolver.toSQL(TABLE, ctx({
          wheres: [{ column: 'name', operator: '=', value: 'alpha', boolean: 'and' }],
        }))
        expect(out).toBeTruthy()
        expect(out.sql ?? out.query ?? out.filter).toBeTruthy()
        // nothing was mutated
        expect(await resolver.select(TABLE, ctx())).toHaveLength(3)
      })
    })

    describe('schema introspection', () => {
      test('hasTable distinguishes present from absent', async () => {
        expect(await resolver.hasTable(TABLE)).toBe(true)
        expect(await resolver.hasTable('definitely_not_here')).toBe(false)
      })

      test('getColumnListing includes the declared columns', async () => {
        const cols = await resolver.getColumnListing(TABLE)
        expect(cols).toContain('name')
        expect(cols).toContain('n')
      })
    })
  })
}
