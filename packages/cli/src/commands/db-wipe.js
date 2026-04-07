import { colors } from '../utils.js'
import { dropAllTables } from './migration-runner.js'

export async function cmdDbWipe(ctx) {
  console.log(`\n${colors.bold}${colors.red}Wiping database — dropping all tables${colors.reset}\n`)

  // Safety confirmation unless --force
  if (!ctx.flags.force && !ctx.flags.f) {
    console.log(`${colors.yellow}⚠${colors.reset}  This will drop ALL tables. Pass ${colors.cyan}--force${colors.reset} to confirm.\n`)
    process.exit(1)
  }

  const { dropped } = await dropAllTables(ctx)

  console.log(`\n${colors.green}✔${colors.reset}  Wiped ${dropped} table${dropped !== 1 ? 's' : ''}.\n`)
}
