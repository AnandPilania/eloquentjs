import { colors, info, success } from '../utils.js'
import { runMigrations } from './migration-runner.js'

export async function cmdMigrate(ctx) {
  console.log(`\n${colors.bold}Running migrations${colors.reset}\n`)

  const { ran, batch } = await runMigrations(ctx)

  if (ran > 0) {
    console.log(`\n${colors.green}✔${colors.reset}  Ran ${ran} migration${ran !== 1 ? 's' : ''} (batch ${batch}).`)
  }
}
