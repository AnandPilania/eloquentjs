#!/usr/bin/env node
/**
 * Verifies all packages in the monorepo share the same version number.
 * Run by CI on every push. Also checks that internal @eloquentjs/* deps
 * are compatible with the declared version.
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { internalRange } from './internal-range.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PACKAGES = [
    '.',
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

const c = {
    reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
    yellow: '\x1b[33m', bold: '\x1b[1m', gray: '\x1b[90m',
}

let failed = false

console.log(`\n${c.bold}Checking version consistency${c.reset}\n`)

// 1. Collect all versions
const versions = PACKAGES.map(dir => {
    const pkgPath = join(ROOT, dir, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return { dir, name: pkg.name, version: pkg.version, pkg }
})

const rootVersion = versions[0].version
console.log(`Expected version: ${c.bold}${rootVersion}${c.reset}\n`)

// 2. Check all match root version
for (const { dir, name, version } of versions) {
    if (version === rootVersion) {
        console.log(`  ${c.green}✔${c.reset}  ${name ?? dir} @ ${version}`)
    } else {
        console.log(`  ${c.red}✖${c.reset}  ${name ?? dir} @ ${version} ${c.red}(expected ${rootVersion})${c.reset}`)
        failed = true
    }
}

// 3. Check internal dependency versions
console.log(`\n${c.bold}Checking internal dependency versions${c.reset}\n`)

for (const { name, pkg } of versions) {
    for (const depField of ['dependencies', 'peerDependencies', 'devDependencies']) {
        if (!pkg[depField]) continue
        for (const [depName, depVer] of Object.entries(pkg[depField])) {
            if (!depName.startsWith('@eloquentjs/')) continue
            // Expected: ^<rootVersion>
            const expected = internalRange(rootVersion)
            if (depVer === expected) {
                console.log(`  ${c.green}✔${c.reset}  ${name} → ${depName}: ${depVer}`)
            } else {
                console.log(`  ${c.yellow}⚠${c.reset}  ${name} → ${depName}: ${depVer} ${c.yellow}(expected ${expected})${c.reset}`)
                // Internal dep mismatch is a warning, not a failure (allows workspace resolution)
            }
        }
    }
}

if (failed) {
    console.log(`\n${c.red}✖ Version mismatch detected!${c.reset}`)
    console.log(`Run ${c.bold}npm run release:patch${c.reset} (or another bump) to sync all versions.\n`)
    process.exit(1)
} else {
    console.log(`\n${c.green}✔ All versions consistent.${c.reset}\n`)
}
