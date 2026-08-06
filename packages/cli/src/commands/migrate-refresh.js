import { colors } from '../utils.js'
import { resetMigrations, runMigrations } from './migration-runner.js'

export async function cmdMigrateRefresh(ctx) {
  console.log(`\n${colors.bold}Refreshing migrations (reset + re-run)${colors.reset}\n`)

  const { rolledBack } = await resetMigrations(ctx)
  if (rolledBack > 0) {
    console.log()
  }

  const { ran } = await runMigrations(ctx)

  console.log(`\n${colors.green}✔${colors.reset}  Refreshed: rolled back ${rolledBack}, ran ${ran} migration${ran !== 1 ? 's' : ''}.`)

  // Optionally seed after refresh
  if (ctx.flags.seed) {
    console.log()
    const { cmdDbSeed } = await import('./db-seed.js')
    await cmdDbSeed(ctx)
  }
}
