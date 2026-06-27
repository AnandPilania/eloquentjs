import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, join, basename } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { createRequire } from 'module'

// ─── Terminal colors ───────────────────────────────────────────────────────
export const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgGreen: '\x1b[42m',
}

export function success(msg) { console.log(`${colors.green}✔${colors.reset}  ${msg}`) }
export function info(msg) { console.log(`${colors.cyan}ℹ${colors.reset}  ${msg}`) }
export function warn(msg) { console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`) }
export function error(msg) { console.log(`${colors.red}✖${colors.reset}  ${msg}`) }
export function dim(msg) { console.log(`${colors.gray}   ${msg}${colors.reset}`) }

// ─── Argument parser ───────────────────────────────────────────────────────
export function parseArgs(args) {
    const flags = {}
    const positional = []
    let command = null

    for (const arg of args) {
        if (arg.startsWith('--')) {
            const [key, val] = arg.slice(2).split('=')
            flags[key] = val !== undefined ? val : true
        } else if (arg.startsWith('-') && arg.length === 2) {
            flags[arg.slice(1)] = true
        } else if (!command) {
            command = arg
        } else {
            positional.push(arg)
        }
    }

    return { command, flags, positional }
}

// ─── File helpers ──────────────────────────────────────────────────────────
export function ensureDir(dir) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function writeFile(path, content, { overwrite = false } = {}) {
    ensureDir(dirname(path))
    if (existsSync(path) && !overwrite) {
        warn(`File already exists, skipping: ${path}`)
        return false
    }
    writeFileSync(path, content, 'utf8')
    return true
}

export function readFile(path) {
    return readFileSync(path, 'utf8')
}

// ─── Name helpers ──────────────────────────────────────────────────────────
export function toPascalCase(str) {
    return str
        .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
        .replace(/^(.)/, (_, c) => c.toUpperCase())
}

export function toCamelCase(str) {
    const pascal = toPascalCase(str)
    return pascal[0].toLowerCase() + pascal.slice(1)
}

export function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
        .replace(/[-\s]+/g, '_')
}

export function toKebabCase(str) {
    return toSnakeCase(str).replace(/_/g, '-')
}

export function toTableName(modelName) {
    // Simple pluralization: User → users, Category → categories
    const snake = toSnakeCase(modelName)
    if (snake.endsWith('y')) return snake.slice(0, -1) + 'ies'
    if (snake.endsWith('s') || snake.endsWith('x') || snake.endsWith('z') || snake.endsWith('ch') || snake.endsWith('sh')) return snake + 'es'
    return snake + 's'
}

// ─── Migration timestamp ────────────────────────────────────────────────────
export function migrationTimestamp() {
    const now = new Date()
    const pad = n => String(n).padStart(2, '0')
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

// ─── Load config with defaults ─────────────────────────────────────────────
export function resolveConfig(ctx) {
    const defaults = {
        paths: {
            models: 'app/models',
            migrations: 'database/migrations',
            seeders: 'database/seeders',
            factories: 'database/factories',
        },
        connection: {
            driver: 'pgsql',
        },
    }

    if (!ctx.config) return defaults

    const { paths: userPaths, connection: userConn, ...rest } = ctx.config
    return {
        ...rest,
        paths: { ...defaults.paths, ...(userPaths ?? {}) },
        connection: { ...defaults.connection, ...(userConn ?? {}) },
    }
}

export function normalizeDriver(driver = 'pgsql') {
    const name = String(driver).toLowerCase()
    const aliases = {
        postgres: 'pgsql',
        postgresql: 'pgsql',
        sqlite3: 'sqlite',
        mongo: 'mongodb',
    }

    return aliases[name] ?? name
}

// ─── Load DB connection for migrate/seed commands ──────────────────────────
export async function loadConnection(ctx) {
    const cfg = resolveConfig(ctx)
    const driver = normalizeDriver(cfg.connection?.driver)

    const driverPackages = {
        pgsql: '@eloquentjs/pgsql',
        postgres: '@eloquentjs/pgsql',
        postgresql: '@eloquentjs/pgsql',
        mongodb: '@eloquentjs/mongodb',
        mongo: '@eloquentjs/mongodb',
        sqlite: '@eloquentjs/sqlite',
        sqlite3: '@eloquentjs/sqlite',
    }
    const pkg = driverPackages[driver]
    if (!pkg) {
        throw new Error(`Unsupported driver: ${driver}. Supported: pgsql, mongodb, sqlite`)
    }

    // Resolve the driver from the user's PROJECT directory, not from wherever the
    // CLI itself is installed. This matters when the CLI is run globally or via a
    // symlinked / `file:` install (e.g. a monorepo demo): the CLI's own location
    // can't always see the project's dependencies, but the project always can.
    const projectDir = ctx.cwd ?? process.cwd()
    let specifier = pkg
    try {
        const requireFromProject = createRequire(join(projectDir, 'package.json'))
        specifier = pathToFileURL(requireFromProject.resolve(pkg)).href
    } catch {
        // Fall back to bare-specifier resolution relative to this CLI module.
    }

    // Keep the driver import isolated from connect() below so a failed DB
    // connection is never misreported as a missing module.
    let connect
    try {
        ({ connect } = await import(specifier))
    } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND') {
            // ERR_MODULE_NOT_FOUND fires both when the driver itself is absent and
            // when the driver loads but one of ITS dependencies (e.g. `pg`) is
            // missing. Surface the real culprit instead of always blaming the driver.
            const missing = /Cannot find package '([^']+)'/.exec(err.message)?.[1]
            if (missing && missing !== pkg) {
                throw new Error(
                    `${pkg} is installed, but its dependency '${missing}' is missing. Run: npm install ${missing}`
                )
            }
            throw new Error(
                `Driver package ${pkg} could not be loaded from "${projectDir}". ` +
                `Run: npm install ${pkg} — and in a monorepo using file: links, run \`npm install\` at the repository root.`
            )
        }
        throw err
    }

    return connect(cfg.connection)
}

// ─── Migration file scanner ─────────────────────────────────────────────────
export function scanMigrations(migrationsDir) {
    if (!existsSync(migrationsDir)) return []
    return readdirSync(migrationsDir)
        .filter(f => f.endsWith('.js'))
        .sort()
        .map(f => ({
            filename: f,
            name: f.replace(/^\d{14}_/, '').replace(/\.js$/, ''),
            path: join(migrationsDir, f),
        }))
}

// ─── Seeder file scanner ───────────────────────────────────────────────────
export function scanSeeders(seedersDir) {
    if (!existsSync(seedersDir)) return []
    return readdirSync(seedersDir)
        .filter(f => f.endsWith('.js'))
        .sort()
        .map(f => ({
            filename: f,
            name: f.replace(/\.js$/, ''),
            path: join(seedersDir, f),
        }))
}
