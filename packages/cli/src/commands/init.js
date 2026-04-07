import { existsSync, readFileSync, writeFileSync } from 'fs'
import { resolve, join } from 'path'
import { colors, success, info, warn, ensureDir, writeFile } from '../utils.js'

export async function cmdInit(ctx) {
    const { cwd, flags } = ctx
    const force = flags.force || flags.f

    console.log(`\n${colors.bold}Initializing EloquentJS${colors.reset}\n`)

    // ── 1. Detect package.json ──────────────────────────────────────────────
    const pkgPath = resolve(cwd, 'package.json')
    if (!existsSync(pkgPath)) {
        warn('No package.json found. Creating one...')
        writeFileSync(pkgPath, JSON.stringify({
            name: 'my-eloquentjs-app',
            version: '0.0.2',
            type: 'module',
            scripts: {
                migrate: 'eloquent migrate',
                seed: 'eloquent db:seed',
            },
        }, null, 2) + '\n', 'utf8')
        success('Created package.json')
    } else {
        // Ensure "type": "module"
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.type !== 'module') {
            pkg.type = 'module'
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
            success('Added "type": "module" to package.json')
        }
    }

    // ── 2. Detect driver preference ─────────────────────────────────────────
    const driver = flags.driver ?? flags.db ?? 'pgsql'
    const validDrivers = ['pgsql', 'postgres', 'postgresql', 'mongodb', 'mongo']
    if (!validDrivers.includes(driver)) {
        throw new Error(`Unknown driver: ${driver}. Choose from: pgsql, mongodb`)
    }
    const normalDriver = (driver === 'postgres' || driver === 'postgresql') ? 'pgsql'
        : (driver === 'mongo') ? 'mongodb'
            : driver

    // ── 3. Write eloquent.config.js ─────────────────────────────────────────
    const configPath = resolve(cwd, 'eloquent.config.js')
    if (existsSync(configPath) && !force) {
        warn('eloquent.config.js already exists. Use --force to overwrite.')
    } else {
        const configContent = generateConfig(normalDriver)
        writeFileSync(configPath, configContent, 'utf8')
        success('Created eloquent.config.js')
    }

    // ── 4. Create directory structure ────────────────────────────────────────
    const dirs = [
        'app/models',
        'database/migrations',
        'database/seeders',
        'database/factories',
    ]
    for (const dir of dirs) {
        const fullPath = resolve(cwd, dir)
        ensureDir(fullPath)
        success(`Created ${dir}/`)
    }

    // ── 5. Write DatabaseSeeder stub ─────────────────────────────────────────
    const seederPath = resolve(cwd, 'database/seeders/DatabaseSeeder.js')
    writeFile(seederPath, generateDatabaseSeeder(), { overwrite: force })
    success('Created database/seeders/DatabaseSeeder.js')

    // ── 6. Write .env.example ────────────────────────────────────────────────
    const envExamplePath = resolve(cwd, '.env.example')
    if (!existsSync(envExamplePath) || force) {
        writeFileSync(envExamplePath, generateEnvExample(normalDriver), 'utf8')
        success('Created .env.example')
    }

    // ── 7. Add .gitignore entries ────────────────────────────────────────────
    const gitignorePath = resolve(cwd, '.gitignore')
    const gitignoreEntries = ['.env', 'node_modules/', '*.log']
    if (existsSync(gitignorePath)) {
        const existing = readFileSync(gitignorePath, 'utf8')
        const missing = gitignoreEntries.filter(e => !existing.includes(e))
        if (missing.length) {
            writeFileSync(gitignorePath, existing + '\n' + missing.join('\n') + '\n', 'utf8')
            success('Updated .gitignore')
        }
    } else {
        writeFileSync(gitignorePath, gitignoreEntries.join('\n') + '\n', 'utf8')
        success('Created .gitignore')
    }

    // ── 8. Print next steps ──────────────────────────────────────────────────
    console.log(`
${colors.bold}${colors.green}✔ EloquentJS initialized successfully!${colors.reset}

${colors.bold}Next steps:${colors.reset}

  1. Install dependencies:
     ${colors.cyan}npm install @eloquentjs/core @eloquentjs/${normalDriver}${colors.reset}

  2. Copy and fill in your environment:
     ${colors.cyan}cp .env.example .env${colors.reset}

  3. Create your first model:
     ${colors.cyan}eloquent make:model User --migration${colors.reset}

  4. Run migrations:
     ${colors.cyan}eloquent migrate${colors.reset}

  5. Seed the database:
     ${colors.cyan}eloquent db:seed${colors.reset}
`)
}

function generateConfig(driver) {
    const envVars = driver === 'pgsql'
        ? `{
    driver:   '${driver}',
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE ?? 'myapp',
    user:     process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    ssl:      process.env.DB_SSL === 'true',
  }`
        : `{
    driver:   '${driver}',
    url:      process.env.MONGO_URL      ?? 'mongodb://localhost:27017',
    database: process.env.MONGO_DATABASE ?? 'myapp',
  }`

    return `/**
 * EloquentJS Configuration
 *
 * This file is loaded by the CLI (eloquent.config.js) and by your app
 * to configure database connections and file paths.
 */

export default {
  // ─── Database connection ─────────────────────────────────────────────────
  connection: ${envVars},

  // ─── File paths ──────────────────────────────────────────────────────────
  paths: {
    models:     'app/models',
    migrations: 'database/migrations',
    seeders:    'database/seeders',
    factories:  'database/factories',
  },
}
`
}

function generateDatabaseSeeder() {
    return `import { Seeder } from '@eloquentjs/core'

export default class DatabaseSeeder extends Seeder {
  async run() {
    // Call your seeders here:
    // await this.call(UserSeeder, PostSeeder)
    console.log('Database seeded.')
  }
}
`
}

function generateEnvExample(driver) {
    if (driver === 'pgsql') {
        return `# PostgreSQL connection
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=myapp
DB_USERNAME=postgres
DB_PASSWORD=
DB_SSL=false
`
    }
    return `# MongoDB connection
MONGO_URL=mongodb://localhost:27017
MONGO_DATABASE=myapp
`
}
