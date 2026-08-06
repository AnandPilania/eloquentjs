#!/usr/bin/env node
/**
 * The CLI entry point. All the logic lives in ../src/index.js, which is safe to
 * import from other tools; only this file touches argv and the exit code.
 */
import { run } from '../src/index.js'

process.exitCode = await run(process.argv.slice(2))
