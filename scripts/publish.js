#!/usr/bin/env node
/**
 * Publishes all EloquentJS packages to npm in the correct dependency order.
 *
 * Usage:
 *   node scripts/publish.js                   → publish with 'latest' tag
 *   node scripts/publish.js --tag=alpha        → publish with 'alpha' dist-tag
 *   node scripts/publish.js --tag=beta         → publish with 'beta' dist-tag
 *   node scripts/publish.js --tag=next         → publish with 'next' dist-tag
 *   node scripts/publish.js --dry-run          → print what would be published
 *   node scripts/publish.js --package=core     → publish only one package
 *   node scripts/publish.js --otp=123456       → pass OTP for 2FA accounts
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Publish order matters — packages that others depend on go first
const PUBLISH_ORDER = [
    { name: '@eloquentjs/core', dir: 'packages/core' },
    { name: '@eloquentjs/codegen', dir: 'packages/codegen' },
    { name: '@eloquentjs/validator', dir: 'packages/validator' },
    { name: '@eloquentjs/pgsql', dir: 'packages/pgsql' },
    { name: '@eloquentjs/mysql', dir: 'packages/mysql' },
    { name: '@eloquentjs/sqlite', dir: 'packages/sqlite' },
    { name: '@eloquentjs/mongodb', dir: 'packages/mongodb' },
    { name: '@eloquentjs/realtime', dir: 'packages/realtime' },
    { name: '@eloquentjs/graphql', dir: 'packages/graphql' },
    { name: '@eloquentjs/api', dir: 'packages/api' },
    { name: '@eloquentjs/cli', dir: 'packages/cli' },
    { name: '@eloquentjs/mcp', dir: 'packages/mcp' },   // depends on cli
]

// ─── Colors ───────────────────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
}
const log = (msg) => console.log(`${c.green}✔${c.reset}  ${msg}`)
const info = (msg) => console.log(`${c.cyan}ℹ${c.reset}  ${msg}`)
const warn = (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`)
const error = (msg) => { console.error(`${c.red}✖${c.reset}  ${msg}`); process.exit(1) }
const dim = (msg) => console.log(`   ${c.gray}${msg}${c.reset}`)

// ─── Args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const tagArg = args.find(a => a.startsWith('--tag='))?.split('=')[1]
const pkgFilter = args.find(a => a.startsWith('--package='))?.split('=')[1]
const otpArg = args.find(a => a.startsWith('--otp='))?.split('=')[1]

// Auto-detect dist-tag from version string
function resolveDistTag(version, explicitTag) {
    if (explicitTag) return explicitTag
    if (version.includes('-alpha.')) return 'alpha'
    if (version.includes('-beta.')) return 'beta'
    if (version.includes('-next.')) return 'next'
    if (version.includes('-rc.')) return 'rc'
    return 'latest'
}

// ─── Check npm auth ───────────────────────────────────────────────────────────
function checkNpmAuth() {
    try {
        const whoami = execSync('npm whoami', { encoding: 'utf8' }).trim()
        log(`Authenticated as: ${c.bold}${whoami}${c.reset}`)
        return whoami
    } catch {
        error('Not authenticated with npm. Run: npm login')
    }
}

// ─── Check if version already published ──────────────────────────────────────
function isPublished(name, version) {
    try {
        execSync(`npm view ${name}@${version} version`, { encoding: 'utf8', stdio: 'pipe' })
        return true
    } catch {
        return false
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n${c.bold}EloquentJS Publish Script${c.reset}\n`)
if (dryRun) warn('DRY RUN — nothing will be published\n')

// Read version
const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = rootPkg.version
const distTag = resolveDistTag(version, tagArg)

info(`Version  : ${c.bold}${version}${c.reset}`)
info(`Dist-tag : ${c.bold}${distTag}${c.reset}`)
console.log()

// Check auth (skip in dry run / CI with token)
if (!dryRun && !process.env.NODE_AUTH_TOKEN) {
    checkNpmAuth()
}

// Filter packages if --package flag
const toPublish = pkgFilter
    ? PUBLISH_ORDER.filter(p => p.dir.includes(pkgFilter) || p.name.includes(pkgFilter))
    : PUBLISH_ORDER

if (toPublish.length === 0) error(`No packages match: ${pkgFilter}`)

const results = { published: [], skipped: [], failed: [] }

for (const { name, dir } of toPublish) {
    const pkgPath = join(ROOT, dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

    if (pkg.private) {
        dim(`${name} — skipped (private)`)
        results.skipped.push(name)
        continue
    }

    // Check if already published
    if (!dryRun && isPublished(name, version)) {
        warn(`${name}@${version} already published — skipping`)
        results.skipped.push(name)
        continue
    }

    info(`Publishing ${c.bold}${name}@${version}${c.reset} → tag: ${distTag}`)

    const publishArgs = [
        'npm publish',
        '--access public',
        `--tag ${distTag}`,
        dryRun ? '--dry-run' : '',
        otpArg ? `--otp ${otpArg}` : '',
    ].filter(Boolean).join(' ')

    try {
        if (dryRun) {
            dim(`[dry-run] cd ${dir} && ${publishArgs}`)
        } else {
            execSync(publishArgs, {
                cwd: join(ROOT, dir),
                stdio: 'inherit',
                env: {
                    ...process.env,
                    // npm_config_tag is an alternative way to set tag
                    npm_config_tag: distTag,
                },
            })
        }
        log(`Published: ${name}@${version}`)
        results.published.push(name)
    } catch (err) {
        results.failed.push(name)
        error(`Failed to publish ${name}: ${err.message}`)
    }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${c.bold}Publish Summary${c.reset}`)
console.log(`  ${c.green}Published : ${results.published.length}${c.reset}`)
if (results.skipped.length) console.log(`  ${c.yellow}Skipped   : ${results.skipped.length}${c.reset}`)
if (results.failed.length) console.log(`  ${c.red}Failed    : ${results.failed.length}${c.reset}`)

if (results.published.length > 0 && !dryRun) {
    console.log()
    if (distTag !== 'latest') {
        console.log(`${c.yellow}Note:${c.reset} Published under dist-tag "${distTag}".`)
        console.log(`Users install with: ${c.cyan}npm install @eloquentjs/core@${distTag}${c.reset}`)
        console.log()
        console.log(`To promote to latest when stable:`)
        for (const name of results.published) {
            console.log(`  ${c.cyan}npm dist-tag add ${name}@${version} latest${c.reset}`)
        }
    } else {
        console.log(`${c.green}All packages published as latest!${c.reset}`)
        console.log(`Install: ${c.cyan}npm install @eloquentjs/core${c.reset}`)
    }
}
console.log()
