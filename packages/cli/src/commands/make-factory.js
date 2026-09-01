import { resolve } from 'path'
import {
  colors, success, error,
  toPascalCase, resolveConfig, writeFile, relativeImportPath,
} from '../utils.js'

export async function cmdMakeFactory(ctx) {
  const { cwd, flags, positional } = ctx
  const cfg = resolveConfig(ctx)

  const rawName = positional[0] ?? flags.name ?? flags.n
  if (!rawName) {
    error('Factory name is required.')
    console.log(`  Usage: ${colors.cyan}eloquent make:factory <FactoryName>${colors.reset}`)
    process.exit(1)
  }

  const modelName = toPascalCase(rawName.replace(/Factory$/i, ''))
  const name = `${modelName}Factory`
  const filename = `${name}.js`
  const factoryPath = resolve(cwd, cfg.paths.factories, filename)

  const modelsPath = relativeImportPath(resolve(cwd, cfg.paths.factories), resolve(cwd, cfg.paths.models))
  const content = generateFactory(name, modelName, modelsPath)
  const created = writeFile(factoryPath, content, { overwrite: flags.force || flags.f })
  if (created) success(`Factory created: ${cfg.paths.factories}/${filename}`)
}

function generateFactory(name, modelName, modelsPath) {
  return `import { Factory } from '@eloquentjs/core'
import { faker } from '@faker-js/faker'
import ${modelName} from '${modelsPath}/${modelName}.js'

export default class ${name} extends Factory {
  model = ${modelName}

  definition() {
    return {
      // name:  faker.person.fullName(),
      // email: faker.internet.email(),
    }
  }

  // ── States ─────────────────────────────────────────────────────────────
  // Define named states for common variations:
  // admin()    { return this.state({ is_admin: true }) }
  // verified() { return this.state({ email_verified_at: new Date() }) }
}
`
}
