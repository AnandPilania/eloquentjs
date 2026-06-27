/**
 * @eloquentjs/cli
 *
 * Usage:
 *   eloquent init                          — initialize EloquentJS in a project
 *   eloquent make:model User               — generate a model
 *   eloquent make:migration create_users   — generate a migration
 *   eloquent make:seeder UserSeeder        — generate a seeder
 *   eloquent make:factory UserFactory      — generate a factory
 *   eloquent migrate                       — run pending migrations
 *   eloquent migrate:rollback              — rollback last batch
 *   eloquent migrate:rollback --step=3     — rollback N batches
 *   eloquent migrate:reset                 — rollback all
 *   eloquent migrate:refresh               — reset + re-run all
 *   eloquent migrate:fresh                 — drop all tables + migrate
 *   eloquent migrate:status                — show migration status
 *   eloquent db:seed                       — run all seeders
 *   eloquent db:seed --class=UserSeeder    — run specific seeder
 *   eloquent db:wipe                       — drop all tables
 *   eloquent list                          — list all commands
 */

import { argv, exit } from 'process'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { pathToFileURL } from 'node:url'

import { cmdInit } from './commands/init.js'
import { cmdMakeModel } from './commands/make-model.js'
import { cmdMakeMigration } from './commands/make-migration.js'
import { cmdMakeSeeder } from './commands/make-seeder.js'
import { cmdMakeFactory } from './commands/make-factory.js'
import { cmdMigrate } from './commands/migrate.js'
import { cmdMigrateRollback } from './commands/migrate-rollback.js'
import { cmdMigrateReset } from './commands/migrate-reset.js'
import { cmdMigrateRefresh } from './commands/migrate-refresh.js'
import { cmdMigrateFresh } from './commands/migrate-fresh.js'
import { cmdMigrateStatus } from './commands/migrate-status.js'
import { cmdDbSeed } from './commands/db-seed.js'
import { cmdDbWipe } from './commands/db-wipe.js'
import { cmdGenerate } from './commands/generate.js'
import { cmdList } from './commands/list.js'
import { colors, parseArgs } from './utils.js'

const args = argv.slice(2)
const { command, flags, positional } = parseArgs(args)

// Banner — version is read from the CLI's own package.json so it never drifts
const pkgVersion = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version
const titleLine = `  EloquentJS CLI  v${pkgVersion}`.padEnd(30)
const banner = `${colors.cyan}╔══════════════════════════════╗
║${titleLine}║
╚══════════════════════════════╝${colors.reset}`

if (!command || command === 'list' || command === '--help' || command === '-h') {
    console.log(banner)
    await cmdList()
    exit(0)
}

// Resolve project root (where eloquent.config.js lives, or cwd)
const cwd = process.cwd()
const configPath = resolve(cwd, 'eloquent.config.js')
const config = existsSync(configPath)
    ? (await import(pathToFileURL(configPath).href)).default
    : null

const ctx = { cwd, config, flags, positional }

try {
    switch (command) {
        case 'init':
            await cmdInit(ctx)
            break

        case 'make:model':
            await cmdMakeModel(ctx)
            break

        case 'make:migration':
            await cmdMakeMigration(ctx)
            break

        case 'make:seeder':
            await cmdMakeSeeder(ctx)
            break

        case 'make:factory':
            await cmdMakeFactory(ctx)
            break

        case 'migrate':
            await cmdMigrate(ctx)
            break

        case 'migrate:rollback':
            await cmdMigrateRollback(ctx)
            break

        case 'migrate:reset':
            await cmdMigrateReset(ctx)
            break

        case 'migrate:refresh':
            await cmdMigrateRefresh(ctx)
            break

        case 'migrate:fresh':
            await cmdMigrateFresh(ctx)
            break

        case 'migrate:status':
            await cmdMigrateStatus(ctx)
            break

        case 'db:seed':
            await cmdDbSeed(ctx)
            break

        case 'db:wipe':
            await cmdDbWipe(ctx)
            break

        case 'generate:graphql':
            await cmdGenerate({ ...ctx, subcommand: 'graphql' })
            break

        case 'generate:types':
            await cmdGenerate({ ...ctx, subcommand: 'types' })
            break

        case 'generate:openapi':
            await cmdGenerate({ ...ctx, subcommand: 'openapi' })
            break

        default:
            console.error(`${colors.red}✖ Unknown command: ${command}${colors.reset}`)
            console.log(`Run ${colors.cyan}eloquent list${colors.reset} to see available commands.`)
            exit(1)
    }
} catch (err) {
    console.error(`\n${colors.red}✖ Error: ${err.message}${colors.reset}`)
    if (flags.verbose || flags.v) console.error(err.stack)
    exit(1)
}
