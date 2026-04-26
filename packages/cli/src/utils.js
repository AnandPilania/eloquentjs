import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { resolve, dirname, join } from 'path'

// ─── Terminal colors ───────────────────────────────────────────────────────
export const colors = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  gray:    '\x1b[90m',
  bgGreen: '\x1b[42m',
}

export function success(msg) { console.log(`${colors.green}✔${colors.reset}  ${msg}`) }
export function info(msg)    { console.log(`${colors.cyan}ℹ${colors.reset}  ${msg}`) }
export function warn(msg)    { console.log(`${colors.yellow}⚠${colors.reset}  ${msg}`) }
export function error(msg)   { console.log(`${colors.red}✖${colors.reset}  ${msg}`) }
export function dim(msg)     { console.log(`${colors.gray}   ${msg}${colors.reset}`) }

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
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

// ─── Load config with defaults ─────────────────────────────────────────────
export function resolveConfig(ctx) {
  const defaults = {
    paths: {
      models:     'app/models',
      migrations: 'database/migrations',
      seeders:    'database/seeders',
      factories:  'database/factories',
    },
    connection: {
      driver: 'pgsql',
    },
  }

  if (!ctx.config) return defaults

  const { paths: userPaths, connection: userConn, ...rest } = ctx.config
  return {
    ...rest,
    paths:      { ...defaults.paths,      ...(userPaths ?? {}) },
    connection: { ...defaults.connection, ...(userConn  ?? {}) },
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

  try {
    if (driver === 'pgsql') {
      const { connect } = await import('@eloquentjs/pgsql')
      return connect(cfg.connection)
    } else if (driver === 'mongodb') {
      const { connect } = await import('@eloquentjs/mongodb')
      return connect(cfg.connection)
    } else if (driver === 'sqlite') {
      const { connect } = await import('@eloquentjs/sqlite')
      return connect(cfg.connection)
    }

    throw new Error(`Unsupported driver: ${driver}. Supported: pgsql, sqlite, mongodb`)
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(`Driver package @eloquentjs/${driver} is not installed. Run: npm install @eloquentjs/${driver}`)
    }
    throw err
  }
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
