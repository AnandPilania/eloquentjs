import { resolve } from 'path'
import { existsSync } from 'fs'
import { colors, success, info, error, resolveConfig, loadConnection, toPascalCase } from '../utils.js'

export async function cmdDbSeed(ctx) {
  const { cwd, flags } = ctx
  const cfg = resolveConfig(ctx)

  const targetClass = flags.class ?? flags.c ?? 'DatabaseSeeder'
  const className = toPascalCase(targetClass.replace(/\.js$/, ''))

  console.log(`\n${colors.bold}Seeding database${colors.reset} ${colors.gray}(${className})${colors.reset}\n`)

  // Find the seeder file
  const seedersDir = resolve(cwd, cfg.paths.seeders)
  const seederFile = resolve(seedersDir, `${className}.js`)

  if (!existsSync(seederFile)) {
    // Try with exact name as given
    const altFile = resolve(seedersDir, `${targetClass}${targetClass.endsWith('.js') ? '' : '.js'}`)
    if (!existsSync(altFile)) {
      throw new Error(
        `Seeder not found: ${seederFile}\n` +
        `  Make sure the file exists or run: ${colors.cyan}eloquent make:seeder ${className}${colors.reset}`
      )
    }
  }

  // Ensure DB connection is available
  let connection
  try {
    connection = await loadConnection(ctx)
  } catch (err) {
    throw new Error(`Cannot connect to database: ${err.message}`)
  }

  // Load and run the seeder
  try {
    const module = await import(seederFile)
    const SeederClass = module.default

    if (!SeederClass) {
      throw new Error(`Seeder file has no default export: ${seederFile}`)
    }

    const seeder = new SeederClass()
    await seeder.run()

    success(`Seeder completed: ${className}`)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`Could not load seeder: ${err.message}`)
    }
    throw err
  }

  console.log(`\n${colors.green}✔${colors.reset}  Database seeded successfully.\n`)
}
