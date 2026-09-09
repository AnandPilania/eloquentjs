/**
 * Perf benchmark — times core QueryBuilder operations against sqlite so
 * regressions show up as a number, not a vibe. Not a cross-ORM shootout
 * (that needs pinned competitor versions + separate harnesses); this times
 * EloquentJS itself, run-over-run, on the same schema the rest of the
 * showcase app uses.
 *
 *   node src/benchmark.js [rows]
 */

import { performance } from 'node:perf_hooks'
import { connect } from '@eloquentjs/sqlite'
import { Model, Schema, DB } from '@eloquentjs/core'

const ROWS = Number(process.argv[2] ?? 2000)

await connect({ filename: ':memory:' })

await Schema.create('bench_items', t => {
  t.id()
  t.string('name')
  t.integer('score')
  t.timestamps()
})

class BenchItem extends Model {
  static table = 'bench_items'
  static fillable = ['name', 'score']
}

async function time(label, fn) {
  const start = performance.now()
  await fn()
  const ms = performance.now() - start
  console.log(`  ${label.padEnd(28)} ${ms.toFixed(1).padStart(8)} ms  (${(ROWS / (ms / 1000)).toFixed(0)} rows/s)`)
}

console.log(`\nEloquentJS benchmark — ${ROWS} rows, sqlite in-memory\n`)

await time('insertMany', () =>
  BenchItem.insert(Array.from({ length: ROWS }, (_, i) => ({ name: `item-${i}`, score: i % 100 })))
)

await time('select all + hydrate', () => BenchItem.query().get())

await time('where + orderBy', () =>
  BenchItem.where('score', '>', 50).orderBy('score', 'desc').get()
)

await time('find by id (loop)', async () => {
  for (let i = 1; i <= Math.min(ROWS, 200); i++) await BenchItem.find(i)
})

await time('count()', () => BenchItem.query().count())

await time('remember() — cold', () => BenchItem.query().remember(60, 'bench:all').get())
await time('remember() — warm (cache hit)', () => BenchItem.query().remember(60, 'bench:all').get())

console.log(`\nPool stats: ${JSON.stringify(DB.poolStats())}\n`)
