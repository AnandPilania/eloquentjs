import { colors, info } from '../utils.js'
import { getMigrationStatus } from './migration-runner.js'

export async function cmdMigrateStatus(ctx) {
  console.log(`\n${colors.bold}Migration Status${colors.reset}\n`)

  const migrations = await getMigrationStatus(ctx)

  if (migrations.length === 0) {
    info('No migration files found.')
    return
  }

  const colW = Math.max(40, ...migrations.map(m => m.filename.length)) + 2

  // Header
  console.log(
    `  ${'Migration'.padEnd(colW)}${'Status'.padEnd(14)}Batch`
  )
  console.log(`  ${'─'.repeat(colW + 20)}`)

  for (const m of migrations) {
    const status = m.ran
      ? `${colors.green}Ran${colors.reset}`
      : `${colors.yellow}Pending${colors.reset}`
    const batch  = m.ran ? `${colors.gray}#${m.batch}${colors.reset}` : ''
    const name   = m.ran
      ? `${colors.white}${m.filename}${colors.reset}`
      : `${colors.gray}${m.filename}${colors.reset}`

    console.log(`  ${name.padEnd(colW + (colors.white.length + colors.reset.length))}${status.padEnd(14 + (colors.green.length + colors.reset.length))}${batch}`)
  }

  const ran     = migrations.filter(m => m.ran).length
  const pending = migrations.filter(m => !m.ran).length

  console.log(`\n  ${colors.gray}${ran} ran, ${pending} pending${colors.reset}\n`)
}
