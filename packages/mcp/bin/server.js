#!/usr/bin/env node
/**
 * eloquent-mcp — MCP server binary (stdio transport)
 * Uses @modelcontextprotocol/sdk for protocol handling.
 *
 * Usage:
 *   npx @eloquentjs/mcp
 *   eloquent-mcp --cwd /path/to/project
 */

import { startStdio } from '../src/server.js'

const args   = process.argv.slice(2)
const cwdIdx = args.indexOf('--cwd')
const cwd    = cwdIdx !== -1 ? args[cwdIdx + 1] : process.cwd()

startStdio({ cwd }).catch(err => {
  process.stderr.write(`[EloquentJS MCP] Fatal: ${err.message}\n`)
  process.exit(1)
})
