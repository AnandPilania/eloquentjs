// Thin re-exports so server.js can import resolve/existsSync as named imports
// without mixing default and named imports from 'fs' and 'path'.
export { resolve, join, dirname, basename } from 'path'
export { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs'
