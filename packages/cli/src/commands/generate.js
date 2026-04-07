/**
 * generate command
 *
 * Usage:
 *   eloquent generate:graphql                  → schema.graphql from all models
 *   eloquent generate:graphql --models=User,Post
 *   eloquent generate:graphql --out=src/schema.graphql
 *   eloquent generate:graphql --pagination=relay
 *
 *   eloquent generate:types                    → models.d.ts from all models
 *   eloquent generate:types --out=src/types/models.d.ts
 *
 *   eloquent generate:openapi                  → openapi.json from all models
 *   eloquent generate:openapi --format=yaml    → openapi.yaml
 *   eloquent generate:openapi --out=docs/openapi.json
 */

import { resolve, join } from 'path'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { colors, success, info, warn, error, resolveConfig } from '../utils.js'

export async function cmdGenerate(ctx) {
    const { cwd, flags, positional } = ctx
    // command is e.g. 'generate:graphql', 'generate:types', 'generate:openapi'
    const subcommand = ctx.subcommand ?? flags.type ?? positional[0]

    switch (subcommand) {
        case 'graphql': return generateGraphql(ctx)
        case 'types': return generateTypes(ctx)
        case 'openapi': return generateOpenApi(ctx)
        default:
            error(`Unknown generate target: ${subcommand}`)
            console.log(`  Available: ${colors.cyan}eloquent generate:graphql${colors.reset}, ${colors.cyan}generate:types${colors.reset}, ${colors.cyan}generate:openapi${colors.reset}`)
            process.exit(1)
    }
}

// ─── generate:graphql ─────────────────────────────────────────────────────────

async function generateGraphql(ctx) {
    const { cwd, flags } = ctx
    const cfg = resolveConfig(ctx)

    const modelsDir = resolve(cwd, flags['models-dir'] ?? cfg.paths.models)
    const outFile = resolve(cwd, flags.out ?? flags.o ?? 'schema.graphql')
    const modelNames = flags.models ? flags.models.split(',').map(s => s.trim()) : null
    const pagination = flags.pagination ?? 'offset'
    const noSubs = flags['no-subscriptions'] ?? false

    console.log(`\n${colors.bold}Generating GraphQL schema${colors.reset}\n`)
    info(`Models dir : ${modelsDir}`)
    info(`Output     : ${outFile}`)
    info(`Pagination : ${pagination}`)
    console.log()

    // Load codegen
    let renderGraphql, loadModelsFromDir, loadModelsByName
    try {
        const r = await import('@eloquentjs/codegen/render')
        renderGraphql = r.renderGraphql
        loadModelsFromDir = r.loadModelsFromDir
        loadModelsByName = r.loadModelsByName
    } catch {
        error(`@eloquentjs/codegen is not installed. Run: ${colors.cyan}npm install @eloquentjs/codegen${colors.reset}`)
        process.exit(1)
    }

    // Load models
    info('Loading models...')
    let models
    if (modelNames) {
        models = await loadModelsByName(modelsDir, modelNames)
        info(`Loaded: ${modelNames.join(', ')}`)
    } else {
        models = await loadModelsFromDir(modelsDir)
        info(`Loaded ${models.length} model${models.length !== 1 ? 's' : ''}: ${models.map(m => m.name).join(', ')}`)
    }

    if (models.length === 0) {
        warn('No models found. Make sure models exist and have a default export.')
        return
    }

    // Generate SDL
    const sdl = await renderGraphql({
        models,
        outputFile: outFile,
        options: { pagination, subscriptions: !noSubs },
    })

    console.log()
    success(`GraphQL schema written: ${outFile}`)
    info(`${sdl.split('\n').length} lines, ${models.length} type${models.length !== 1 ? 's' : ''}`)

    console.log(`\n  Use it with Apollo Server:`)
    console.log(`  ${colors.gray}import { readFileSync } from 'fs'`)
    console.log(`  const typeDefs = readFileSync('${outFile}', 'utf8')${colors.reset}\n`)
}

// ─── generate:types ───────────────────────────────────────────────────────────

async function generateTypes(ctx) {
    const { cwd, flags } = ctx
    const cfg = resolveConfig(ctx)

    const modelsDir = resolve(cwd, flags['models-dir'] ?? cfg.paths.models)
    const outFile = resolve(cwd, flags.out ?? flags.o ?? 'src/types/models.d.ts')
    const modelNames = flags.models ? flags.models.split(',').map(s => s.trim()) : null

    console.log(`\n${colors.bold}Generating TypeScript types${colors.reset}\n`)
    info(`Models dir : ${modelsDir}`)
    info(`Output     : ${outFile}`)
    console.log()

    let renderTypeScript, loadModelsFromDir, loadModelsByName
    try {
        const r = await import('@eloquentjs/codegen/render')
        renderTypeScript = r.renderTypeScript
        loadModelsFromDir = r.loadModelsFromDir
        loadModelsByName = r.loadModelsByName
    } catch {
        error(`@eloquentjs/codegen is not installed. Run: ${colors.cyan}npm install @eloquentjs/codegen${colors.reset}`)
        process.exit(1)
    }

    info('Loading models...')
    const models = modelNames
        ? await loadModelsByName(modelsDir, modelNames)
        : await loadModelsFromDir(modelsDir)
    info(`Loaded ${models.length} model${models.length !== 1 ? 's' : ''}: ${models.map(m => m.name).join(', ')}`)

    if (models.length === 0) { warn('No models found.'); return }

    const ts = await renderTypeScript({
        models,
        outputFile: outFile,
        options: { includeCreateInput: true, includeUpdateInput: true },
    })

    console.log()
    success(`TypeScript types written: ${outFile}`)
    info(`${ts.split('\n').length} lines, ${models.length} interface${models.length !== 1 ? 's' : ''}`)
    console.log()
}

// ─── generate:openapi ─────────────────────────────────────────────────────────

async function generateOpenApi(ctx) {
    const { cwd, flags } = ctx
    const cfg = resolveConfig(ctx)

    const modelsDir = resolve(cwd, flags['models-dir'] ?? cfg.paths.models)
    const format = flags.format ?? 'json'
    const ext = format === 'yaml' ? 'yaml' : 'json'
    const outFile = resolve(cwd, flags.out ?? flags.o ?? `openapi.${ext}`)
    const modelNames = flags.models ? flags.models.split(',').map(s => s.trim()) : null
    const apiTitle = flags.title ?? ctx.config?.name ?? 'API'

    console.log(`\n${colors.bold}Generating OpenAPI spec${colors.reset}\n`)
    info(`Models dir : ${modelsDir}`)
    info(`Output     : ${outFile}`)
    info(`Format     : ${format}`)
    console.log()

    let renderOpenApi, loadModelsFromDir, loadModelsByName
    try {
        const r = await import('@eloquentjs/codegen/render')
        renderOpenApi = r.renderOpenApi
        loadModelsFromDir = r.loadModelsFromDir
        loadModelsByName = r.loadModelsByName
    } catch {
        error(`@eloquentjs/codegen is not installed. Run: ${colors.cyan}npm install @eloquentjs/codegen${colors.reset}`)
        process.exit(1)
    }

    info('Loading models...')
    const models = modelNames
        ? await loadModelsByName(modelsDir, modelNames)
        : await loadModelsFromDir(modelsDir)
    info(`Loaded ${models.length} model${models.length !== 1 ? 's' : ''}: ${models.map(m => m.name).join(', ')}`)

    if (models.length === 0) { warn('No models found.'); return }

    await renderOpenApi({
        models,
        outputFile: outFile,
        format,
        options: {
            title: apiTitle,
            version: ctx.config?.version ?? '0.0.2',
        },
    })

    console.log()
    success(`OpenAPI spec written: ${outFile}`)
    info(`${models.length} resource${models.length !== 1 ? 's' : ''} documented`)
    console.log(`\n  View with Swagger UI: ${colors.cyan}npx @redocly/cli preview-docs ${outFile}${colors.reset}\n`)
}
