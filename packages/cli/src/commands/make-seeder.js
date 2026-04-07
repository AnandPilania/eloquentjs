import { resolve } from 'path'
import {
  colors, success, error,
  toPascalCase, resolveConfig, writeFile,
} from '../utils.js'

export async function cmdMakeSeeder(ctx) {
  const { cwd, flags, positional } = ctx
  const cfg = resolveConfig(ctx)

  const rawName = positional[0] ?? flags.name ?? flags.n
  if (!rawName) {
    error('Seeder name is required.')
    console.log(`  Usage: ${colors.cyan}eloquent make:seeder <SeederName>${colors.reset}`)
    process.exit(1)
  }

  const name = toPascalCase(rawName.replace(/Seeder$/i, '')) + 'Seeder'
  const filename = `${name}.js`
  const seederPath = resolve(cwd, cfg.paths.seeders, filename)

  const content = generateSeeder(name)
  const created = writeFile(seederPath, content, { overwrite: flags.force || flags.f })
  if (created) success(`Seeder created: ${cfg.paths.seeders}/${filename}`)
}

function generateSeeder(name) {
  const modelName = name.replace(/Seeder$/, '')
  return `import { Seeder } from '@eloquentjs/core'
// import ${modelName}Factory from '../factories/${modelName}Factory.js'

export default class ${name} extends Seeder {
  async run() {
    // await ${modelName}Factory.new().count(10).create()
    console.log('${name} done.')
  }
}
`
}
