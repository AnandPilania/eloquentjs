/**
 * @eloquentjs/codegen — loadModelsFromDir, against real files on disk.
 *
 * Separate from Codegen.test.js because that file mocks `fs` at the module
 * level to keep the template/introspect tests hermetic; loadModelsFromDir's
 * dynamic `import()` of model files needs real files to import.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadModelsFromDir } from '../../packages/codegen/src/render.js'

describe('loadModelsFromDir', () => {
  let dir

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eloquentjs-render-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('loads one model per file with a default export', async () => {
    writeFileSync(join(dir, 'User.js'), `export default class User {}`)
    writeFileSync(join(dir, 'Post.js'), `export default class Post {}`)

    const models = await loadModelsFromDir(dir)
    expect(models.map(m => m.name).sort()).toEqual(['Post', 'User'])
  })

  // A models/index.js barrel re-exporting every model as a named export has
  // no `default` export. Scanning it used to fall back to "the first
  // function-typed export" — silently dropping every other model in the
  // barrel and duplicating whichever one a module namespace object happens
  // to sort first (module namespace keys are ordered alphabetically).
  test('skips an index.js barrel instead of guessing one export from it', async () => {
    writeFileSync(join(dir, 'User.js'), `export default class User {}`)
    writeFileSync(join(dir, 'Comment.js'), `export default class Comment {}`)
    writeFileSync(
      join(dir, 'index.js'),
      `export { default as User } from './User.js'\nexport { default as Comment } from './Comment.js'\n`,
    )

    const models = await loadModelsFromDir(dir)
    expect(models.map(m => m.name).sort()).toEqual(['Comment', 'User'])
  })
})
