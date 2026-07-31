#!/usr/bin/env node
/**
 * Syntax check every source file.
 *
 * `node --check <file>` parses the file without executing it and exits non-zero
 * on a syntax error. This is not a style linter — the repo has no ESLint config
 * — but it does catch the class of breakage the previous CI step claimed to
 * catch and could not (piping a module to stdin *ran* it, then `|| true`
 * discarded the result).
 */

import { execFileSync } from 'node:child_process'
import { glob } from 'glob'

const patterns = ['packages/*/src/**/*.js', 'packages/*/bin/*.js', 'scripts/*.js', 'tests/**/*.js']

const files = (await Promise.all(patterns.map(p => glob(p, { posix: true })))).flat().sort()
if (!files.length) {
  console.error('No source files matched — check the patterns in scripts/lint.js')
  process.exit(1)
}

const failures = []
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (err) {
    failures.push({ file, output: (err.stderr?.toString() ?? err.message).trim() })
  }
}

for (const { file, output } of failures) {
  console.error(`\n\x1b[31m✖ ${file}\x1b[0m\n${output}`)
}

console.log(
  failures.length
    ? `\n${failures.length} of ${files.length} files failed to parse.`
    : `\x1b[32m✔\x1b[0m ${files.length} files parsed cleanly.`
)

process.exit(failures.length ? 1 : 0)
