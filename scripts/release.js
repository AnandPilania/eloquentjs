#!/usr/bin/env node
/**
 * Usage:
 *   node scripts/release.js patch              → 1.0.0 → 1.0.1
 *   node scripts/release.js minor              → 1.0.0 → 1.1.0
 *   node scripts/release.js major              → 1.0.0 → 2.0.0
 *   node scripts/release.js alpha              → 1.0.0 → 1.0.1-alpha.0
 *   node scripts/release.js beta               → 1.0.0 → 1.0.1-beta.0
 *   node scripts/release.js rc                 → 1.0.0 → 1.0.1-rc.0
 *   node scripts/release.js next               → 1.0.0 → 1.0.1-next.0
 *   node scripts/release.js alpha --preminc    → 1.0.1-alpha.0 → 1.0.1-alpha.1
 *   node scripts/release.js 2.1.0              → explicit version
 *
 * Flags:
 *   --dry-run      Print what would happen without writing anything
 *   --no-git       Skip git commit + tag (just update files)
 *   --no-changelog Skip changelog generation
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { internalRange } from './internal-range.js'

// ─── Config ───────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PACKAGES = [
    'packages/core',
    'packages/codegen',
    'packages/validator',
    'packages/pgsql',
    'packages/mysql',
    'packages/sqlite',
    'packages/mongodb',
    'packages/realtime',
    'packages/graphql',
    'packages/api',
    'packages/mcp',
    'packages/cli',
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
const dim = (msg) => console.log(`${c.gray}   ${msg}${c.reset}`)

// ─── Arg parsing ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const bump = args.find(a => !a.startsWith('--')) ?? 'patch'
const dryRun = args.includes('--dry-run')
const noGit = args.includes('--no-git')
const noLog = args.includes('--no-changelog')
const preInc = args.includes('--preminc')

// ─── Version helpers ──────────────────────────────────────────────────────────
function parseVersion(v) {
    // Handles: 1.2.3, 1.2.3-alpha.0, 1.2.3-beta.2, 1.2.3-rc.1, 1.2.3-next.0
    // Keep the channel list in sync with distTagFor() in scripts/publish.js.
    const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc|next)\.(\d+))?$/)
    if (!match) error(`Cannot parse version: ${v}`)
    return {
        major: parseInt(match[1]),
        minor: parseInt(match[2]),
        patch: parseInt(match[3]),
        pre: match[4] ?? null,
        preN: match[5] != null ? parseInt(match[5]) : null,
    }
}

function formatVersion({ major, minor, patch, pre, preN }) {
    let v = `${major}.${minor}.${patch}`
    if (pre != null) v += `-${pre}.${preN}`
    return v
}

function bumpVersion(current, bump) {
    const v = parseVersion(current)

    const CHANNELS = ['alpha', 'beta', 'rc', 'next']

    // Explicit version string
    if (/^\d+\.\d+\.\d+/.test(bump) && !CHANNELS.includes(bump)) {
        return bump
    }

    switch (bump) {
        case 'major':
            return formatVersion({ major: v.major + 1, minor: 0, patch: 0, pre: null, preN: null })

        case 'minor':
            return formatVersion({ major: v.major, minor: v.minor + 1, patch: 0, pre: null, preN: null })

        case 'patch':
            if (v.pre) {
                // Drop pre-release suffix: 1.0.1-alpha.2 → 1.0.1
                return formatVersion({ ...v, pre: null, preN: null })
            }
            return formatVersion({ major: v.major, minor: v.minor, patch: v.patch + 1, pre: null, preN: null })

        case 'alpha':
        case 'beta':
        case 'rc':
        case 'next':
            if (v.pre === bump && preInc) {
                // Increment pre-release number: alpha.0 → alpha.1
                return formatVersion({ ...v, preN: v.preN + 1 })
            }
            if (v.pre === bump) {
                // Same pre-release type, increment
                return formatVersion({ ...v, preN: (v.preN ?? -1) + 1 })
            }
            // Start new pre-release from next patch
            const nextPatch = v.pre ? v.patch : v.patch + 1
            return formatVersion({ major: v.major, minor: v.minor, patch: nextPatch, pre: bump, preN: 0 })

        default:
            error(`Unknown bump type: ${bump}. Use: patch, minor, major, ${CHANNELS.join(', ')}, or an explicit version.`)
    }
}

// ─── Read / Write package.json ────────────────────────────────────────────────
function readPkg(pkgDir) {
    const path = join(ROOT, pkgDir, 'package.json')
    return JSON.parse(readFileSync(path, 'utf8'))
}

function writePkg(pkgDir, pkg) {
    const path = join(ROOT, pkgDir, 'package.json')
    if (!dryRun) writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}

// ─── Git helpers ──────────────────────────────────────────────────────────────
function git(cmd) {
    if (dryRun) { dim(`[dry-run] git ${cmd}`); return '' }
    return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim()
}

function getGitLog(since) {
    try {
        const range = since ? `${since}..HEAD` : 'HEAD'
        return execSync(
            `git log ${range} --pretty=format:"%s|%h|%an" --no-merges`,
            { cwd: ROOT, encoding: 'utf8' }
        ).trim().split('\n').filter(Boolean)
    } catch {
        return []
    }
}

function getLatestTag() {
    try {
        return execSync('git describe --tags --abbrev=0', { cwd: ROOT, encoding: 'utf8' }).trim()
    } catch {
        return null
    }
}

// ─── Changelog generation ─────────────────────────────────────────────────────
const CC_TYPES = {
    feat: '✨ Features',
    fix: '🐛 Bug Fixes',
    perf: '⚡ Performance',
    refactor: '♻️  Refactoring',
    docs: '📝 Documentation',
    test: '✅ Tests',
    chore: '🔧 Chores',
    ci: '👷 CI',
    build: '🏗️  Build',
    revert: '⏪ Reverts',
    breaking: '💥 Breaking Changes',
}

function parseCommit(line) {
    const [msg, hash, author] = line.split('|')
    // Conventional commit: type(scope): description
    const match = msg.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/)
    if (!match) return { type: 'other', scope: null, breaking: false, desc: msg, hash, author }
    return {
        type: match[1],
        scope: match[2] ?? null,
        breaking: match[3] === '!',
        desc: match[4],
        hash,
        author,
    }
}

function generateChangelog(version, commits) {
    const grouped = {}
    const breaking = []

    for (const line of commits) {
        const c = parseCommit(line)
        if (c.breaking) breaking.push(c)
        const type = CC_TYPES[c.type] ?? '🔀 Other Changes'
        if (!grouped[type]) grouped[type] = []
        grouped[type].push(c)
    }

    const date = new Date().toISOString().slice(0, 10)
    let md = `## [${version}] — ${date}\n\n`

    if (breaking.length) {
        md += `### 💥 Breaking Changes\n\n`
        for (const c of breaking) {
            const scope = c.scope ? `**${c.scope}:** ` : ''
            md += `- ${scope}${c.desc} (\`${c.hash}\`)\n`
        }
        md += '\n'
    }

    for (const [section, items] of Object.entries(grouped)) {
        if (section === '💥 Breaking Changes') continue
        if (!items.length) continue
        md += `### ${section}\n\n`
        for (const c of items) {
            const scope = c.scope ? `**${c.scope}:** ` : ''
            md += `- ${scope}${c.desc} (\`${c.hash}\`)\n`
        }
        md += '\n'
    }

    return md
}

function updateChangelog(version, newSection) {
    const changelogPath = join(ROOT, 'CHANGELOG.md')
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : '# Changelog\n\nAll notable changes to EloquentJS are documented here.\n\n'

    // Insert after the header line
    const headerEnd = existing.indexOf('\n\n') + 2
    const header = existing.slice(0, headerEnd)
    const rest = existing.slice(headerEnd)
    const updated = `${header}${newSection}\n---\n\n${rest}`

    if (!dryRun) writeFileSync(changelogPath, updated, 'utf8')
}

// ─── Main ─────────────────────────────────────────────────────────────────────
console.log(`\n${c.bold}EloquentJS Release Script${c.reset}\n`)

if (dryRun) warn('DRY RUN — no files will be written, no git commands will run\n')

// 1. Read current version from root package.json
const rootPkg = readPkg('.')
const currentVer = rootPkg.version ?? '1.0.0'
const nextVer = bumpVersion(currentVer, bump)

info(`Current version : ${c.bold}${currentVer}${c.reset}`)
info(`Next version    : ${c.bold}${c.green}${nextVer}${c.reset}`)
info(`Bump type       : ${bump}`)
console.log()

// 2. Validate working tree is clean (unless --no-git or --dry-run)
if (!noGit && !dryRun) {
    const status = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim()
    if (status) {
        error('Working directory has uncommitted changes. Commit or stash them first.\n\n' + status)
    }
}

// 3. Run tests
info('Running tests...')
if (!dryRun) {
    try {
        execSync('node --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/ --no-coverage --silent', {
            cwd: ROOT, stdio: 'inherit'
        })
    } catch {
        error('Tests failed. Fix them before releasing.')
    }
}
log('Tests passed')

// 4. Bump version in all package.json files
info(`Bumping version in ${PACKAGES.length + 1} packages...`)

// Root
const newRootPkg = { ...rootPkg, version: nextVer }
writePkg('.', newRootPkg)
dim(`package.json → ${nextVer}`)

// Each package
for (const pkgDir of PACKAGES) {
    const pkg = readPkg(pkgDir)
    const newPkg = { ...pkg, version: nextVer }

    // Update internal @eloquentjs/* peer/dep versions to match
    for (const depField of ['dependencies', 'peerDependencies', 'devDependencies']) {
        if (!newPkg[depField]) continue
        for (const name of Object.keys(newPkg[depField])) {
            if (name.startsWith('@eloquentjs/')) {
                newPkg[depField][name] = internalRange(nextVer)
            }
        }
    }

    writePkg(pkgDir, newPkg)
    dim(`${pkgDir}/package.json → ${nextVer}`)
}
log('All package versions updated')

// 5. Generate changelog
if (!noLog) {
    const latestTag = getLatestTag()
    const commits = getGitLog(latestTag)

    if (commits.length > 0) {
        const section = generateChangelog(nextVer, commits)
        updateChangelog(nextVer, section)
        log(`Changelog updated (${commits.length} commits)`)
    } else {
        warn('No commits found since last tag — changelog not updated')
    }
}

// 6. Git commit + tag
if (!noGit) {
    const isPreRelease = nextVer.includes('-alpha.') || nextVer.includes('-beta.')
    const tag = `v${nextVer}`

    git('add -A')
    git(`commit -m "chore(release): ${nextVer}"`)
    log(`Git commit: chore(release): ${nextVer}`)

    if (isPreRelease) {
        git(`tag ${tag}`)
        log(`Git tag: ${tag}`)
        info(`Pre-release tag created. Push with: ${c.cyan}git push && git push --tags${c.reset}`)
    } else {
        git(`tag -a ${tag} -m "Release ${tag}"`)
        log(`Git annotated tag: ${tag}`)
        info(`Push with: ${c.cyan}git push && git push --tags${c.reset}`)
    }
}

// 7. Summary
console.log(`\n${c.bold}${c.green}Release ${nextVer} prepared successfully!${c.reset}\n`)

if (!noGit && !dryRun) {
    console.log('Next steps:')
    console.log(`  1. Review the changes: ${c.cyan}git diff HEAD~1${c.reset}`)
    console.log(`  2. Push to remote:     ${c.cyan}git push && git push --tags${c.reset}`)
    console.log(`  3. GitHub Actions will publish to npm automatically on tag push.`)
    console.log(`     Or publish manually: ${c.cyan}npm run publish:all${c.reset}\n`)
}
