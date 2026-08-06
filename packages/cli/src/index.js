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
 *
 * Programmatic use — importing this module has no side effects:
 *   import { run } from '@eloquentjs/cli'
 *   const code = await run(['migrate', '--step=1'], { cwd })
 */

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

/** command name -> handler. One place to add a command. */
const COMMANDS = {
    'init': cmdInit,
    'make:model': cmdMakeModel,
    'make:migration': cmdMakeMigration,
    'make:seeder': cmdMakeSeeder,
    'make:factory': cmdMakeFactory,
    'migrate': cmdMigrate,
    'migrate:rollback': cmdMigrateRollback,
    'migrate:reset': cmdMigrateReset,
    'migrate:refresh': cmdMigrateRefresh,
    'migrate:fresh': cmdMigrateFresh,
    'migrate:status': cmdMigrateStatus,
    'db:seed': cmdDbSeed,
    'db:wipe': cmdDbWipe,
    'generate:graphql': ctx => cmdGenerate({ ...ctx, subcommand: 'graphql' }),
    'generate:types': ctx => cmdGenerate({ ...ctx, subcommand: 'types' }),
    'generate:openapi': ctx => cmdGenerate({ ...ctx, subcommand: 'openapi' }),
}

export function version() {
    // Read from the CLI's own package.json so it never drifts from the release.
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
}

export function banner() {
    const width = 30
    const titleLine = `  EloquentJS CLI  v${version()}`.padEnd(width)
    const bar = '═'.repeat(width)
    return `${colors.cyan}╔${bar}╗\n║${titleLine}║\n╚${bar}╝${colors.reset}`
}

/**
 * Run one CLI invocation.
 *
 * This module is the package entry point AND the CLI implementation, so it must
 * not execute or call process.exit() at import time — `import '@eloquentjs/cli'`
 * used to parse argv, run a command and terminate the host process. bin/eloquent.js
 * calls this and maps the return value to an exit code.
 *
 * @param {string[]} [args] defaults to process.argv.slice(2)
 * @param {{cwd?: string, silent?: boolean}} [opts]
 * @returns {Promise<number>} the process exit code
 */
export async function run(args = process.argv.slice(2), { cwd = process.cwd(), silent = false } = {}) {
    const { command, flags, positional } = parseArgs(args)
    const log = silent ? () => { } : console.log

    // `--version` arrives as a flag, not a command, so it is checked first.
    if (flags.version || flags.V) {
        log(version())
        return 0
    }

    if (!command || command === 'list' || flags.help || flags.h) {
        log(banner())
        await cmdList()
        return 0
    }

    // Resolve project root (where eloquent.config.js lives, or cwd)
    const configPath = resolve(cwd, 'eloquent.config.js')
    const config = existsSync(configPath)
        ? (await import(pathToFileURL(configPath).href)).default
        : null

    const ctx = { cwd, config, flags, positional }
    const handler = COMMANDS[command]

    if (!handler) {
        console.error(`${colors.red}✖ Unknown command: ${command}${colors.reset}`)
        log(`Run ${colors.cyan}eloquent list${colors.reset} to see available commands.`)
        return 1
    }

    try {
        await handler(ctx)
        return 0
    } catch (err) {
        console.error(`
${colors.red}✖ Error: ${err.message}${colors.reset}`)
        if (flags.verbose || flags.v) console.error(err.stack)
        return 1
    }
}

export { COMMANDS }
