import { colors } from '../utils.js'
import { rollbackMigrations } from './migration-runner.js'

export async function cmdMigrateRollback(ctx) {
  const step = parseInt(ctx.flags.step ?? ctx.flags.s ?? 1)

  console.log(`\n${colors.bold}Rolling back ${step} batch${step !== 1 ? 'es' : ''}${colors.reset}\n`)

  const { rolledBack } = await rollbackMigrations(ctx, { step })

  if (rolledBack > 0) {
    console.log(`\n${colors.green}✔${colors.reset}  Rolled back ${rolledBack} migration${rolledBack !== 1 ? 's' : ''}.`)
  }
}
