import { colors } from '../utils.js'
import { dropAllTables, runMigrations } from './migration-runner.js'

export async function cmdMigrateFresh(ctx) {
  console.log(`\n${colors.bold}Dropping all tables and re-running migrations${colors.reset}\n`)

  const { dropped } = await dropAllTables(ctx)
  if (dropped > 0) console.log()

  const { ran, batch } = await runMigrations(ctx)

  console.log(`\n${colors.green}✔${colors.reset}  Fresh migration complete: dropped ${dropped} table${dropped !== 1 ? 's' : ''}, ran ${ran} migration${ran !== 1 ? 's' : ''}.`)

  // Optionally seed after fresh
  if (ctx.flags.seed) {
    console.log()
    const { cmdDbSeed } = await import('./db-seed.js')
    await cmdDbSeed(ctx)
  }
}
