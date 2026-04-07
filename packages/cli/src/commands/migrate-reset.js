import { colors } from '../utils.js'
import { resetMigrations } from './migration-runner.js'

export async function cmdMigrateReset(ctx) {
  console.log(`\n${colors.bold}Resetting all migrations${colors.reset}\n`)

  const { rolledBack } = await resetMigrations(ctx)

  if (rolledBack > 0) {
    console.log(`\n${colors.green}✔${colors.reset}  Rolled back ${rolledBack} migration${rolledBack !== 1 ? 's' : ''}.`)
  }
}
