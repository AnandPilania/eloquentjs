/**
 * @eloquentjs/codegen — Render Engine
 *
 * Loads Model class files from disk, introspects them, and renders
 * any target artifact (graphql, typescript, openapi, stubs).
 *
 * Used by:
 *   - CLI `generate:*` commands
 *   - @eloquentjs/graphql (runtime schema building)
 */

import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, join, dirname, basename } from 'path'
import { introspect, introspectAll } from './introspect.js'
import {
  generateGraphqlSchema,
  generateTypeScriptFile,
  generateOpenApiSpec,
  generateModelStub,
  generateMigrationStub,
  generateFactoryStub,
  generateSeederStub,
} from './templates/index.js'

// ─── Load models from a directory ─────────────────────────────────────────────

/**
 * Dynamically import all Model classes from a directory.
 * @param {string} modelsDir — absolute path
 * @returns {Promise<Function[]>} — array of Model subclasses
 */
export async function loadModelsFromDir(modelsDir) {
  if (!existsSync(modelsDir)) return []

  const files = readdirSync(modelsDir)
    .filter(f => f.endsWith('.js') && !f.startsWith('_') && !f.startsWith('.'))

  const models = []
  for (const file of files) {
    try {
      const mod = await import(join(modelsDir, file))
      const ModelClass = mod.default ?? Object.values(mod).find(v => typeof v === 'function')
      if (ModelClass && typeof ModelClass === 'function') {
        models.push(ModelClass)
      }
    } catch (err) {
      // Skip files that fail to import (may have missing dependencies)
      console.warn(`  ⚠  Skipping ${file}: ${err.message}`)
    }
  }

  return models
}

/**
 * Load specific models by name from a directory.
 * @param {string} modelsDir
 * @param {string[]} names — e.g. ['User', 'Post']
 * @returns {Promise<Function[]>}
 */
export async function loadModelsByName(modelsDir, names) {
  const models = []
  for (const name of names) {
    const file = join(modelsDir, `${name}.js`)
    if (!existsSync(file)) {
      throw new Error(`Model file not found: ${file}`)
    }
    const mod = await import(file)
    const ModelClass = mod.default ?? Object.values(mod).find(v => typeof v === 'function')
    if (!ModelClass) throw new Error(`No default export in ${file}`)
    models.push(ModelClass)
  }
  return models
}

// ─── Render functions ─────────────────────────────────────────────────────────

/**
 * Render a GraphQL schema file from model classes or a models directory.
 */
export async function renderGraphql(opts = {}) {
  const { models, modelsDir, outputFile, options = {} } = opts
  const classes  = models ?? await loadModelsFromDir(modelsDir)
  const schemas  = introspectAll(classes)
  const sdl      = generateGraphqlSchema(schemas, options)
  if (outputFile) {
    ensureDir(dirname(outputFile))
    writeFileSync(outputFile, sdl, 'utf8')
  }
  return sdl
}

/**
 * Render a TypeScript declaration file from model classes or a models directory.
 */
export async function renderTypeScript(opts = {}) {
  const { models, modelsDir, outputFile, options = {} } = opts
  const classes  = models ?? await loadModelsFromDir(modelsDir)
  const schemas  = introspectAll(classes)
  const ts       = generateTypeScriptFile(schemas, options)
  if (outputFile) {
    ensureDir(dirname(outputFile))
    writeFileSync(outputFile, ts, 'utf8')
  }
  return ts
}

/**
 * Render an OpenAPI spec from model classes or a models directory.
 */
export async function renderOpenApi(opts = {}) {
  const { models, modelsDir, outputFile, format = 'json', options = {} } = opts
  const classes  = models ?? await loadModelsFromDir(modelsDir)
  const schemas  = introspectAll(classes)
  const spec     = generateOpenApiSpec(schemas, options)
  const content  = format === 'yaml' ? toYaml(spec) : JSON.stringify(spec, null, 2)
  if (outputFile) {
    ensureDir(dirname(outputFile))
    writeFileSync(outputFile, content, 'utf8')
  }
  return spec
}

/**
 * Render a complete set of stubs for a model descriptor.
 * Used by CLI make:model when --from-schema or --schema-first is requested.
 */
export function renderStubs(schema, opts = {}) {
  return {
    model:     generateModelStub(schema, opts),
    migration: generateMigrationStub(`create_${schema.table}_table`, schema, opts),
    factory:   generateFactoryStub(schema, opts),
    seeder:    generateSeederStub(schema, opts),
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Minimal YAML serializer for OpenAPI specs (no external deps).
 * Only handles the subset of types OpenAPI specs contain.
 */
function toYaml(obj, indent = 0) {
  const pad = '  '.repeat(indent)
  if (obj === null)      return 'null'
  if (obj === true)      return 'true'
  if (obj === false)     return 'false'
  if (typeof obj === 'number') return String(obj)
  if (typeof obj === 'string') {
    // Quote strings that contain special YAML chars
    if (/[:{}\[\],#&*!|>'"%@`\n]/.test(obj) || obj === '' || /^\s/.test(obj)) {
      return `"${obj.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
    }
    return obj
  }
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    return '\n' + obj.map(v => `${pad}- ${toYaml(v, indent + 1).trimStart()}`).join('\n')
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined)
    if (entries.length === 0) return '{}'
    return '\n' + entries
      .map(([k, v]) => {
        const val = toYaml(v, indent + 1)
        return val.startsWith('\n')
          ? `${pad}${k}:${val}`
          : `${pad}${k}: ${val}`
      })
      .join('\n')
  }
  return String(obj)
}
