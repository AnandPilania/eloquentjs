/**
 * @eloquentjs/cli — Unit Tests
 *
 * Tests all CLI utilities and command logic without touching the filesystem
 * or database. Filesystem calls are mocked; DB runner functions are tested
 * via their pure logic where possible.
 */

import { jest } from '@jest/globals'

// ─── Mock fs module ──────────────────────────────────────────────────────────
const mockFs = {
  existsSync:     jest.fn(),
  mkdirSync:      jest.fn(),
  writeFileSync:  jest.fn(),
  readFileSync:   jest.fn(),
  readdirSync:    jest.fn(),
}
jest.unstable_mockModule('fs', () => mockFs)

// ─── Mock process.exit so tests don't actually exit ──────────────────────────
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`)
})

// ─── Import after mocks ───────────────────────────────────────────────────────
const {
  parseArgs,
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toKebabCase,
  toTableName,
  migrationTimestamp,
  resolveConfig,
  scanMigrations,
  scanSeeders,
  colors,
  ensureDir,
  writeFile,
} = await import('../../packages/cli/src/utils.js')

// ─────────────────────────────────────────────────────────────────────────────
// parseArgs
// ─────────────────────────────────────────────────────────────────────────────
describe('parseArgs', () => {
  test('parses a simple command', () => {
    const { command, flags, positional } = parseArgs(['migrate'])
    expect(command).toBe('migrate')
    expect(flags).toEqual({})
    expect(positional).toEqual([])
  })

  test('parses command with positional arg', () => {
    const { command, positional } = parseArgs(['make:model', 'User'])
    expect(command).toBe('make:model')
    expect(positional).toEqual(['User'])
  })

  test('parses --key=value flags', () => {
    const { flags } = parseArgs(['migrate:rollback', '--step=3'])
    expect(flags.step).toBe('3')
  })

  test('parses --boolean flags', () => {
    const { flags } = parseArgs(['make:model', 'User', '--migration', '--force'])
    expect(flags.migration).toBe(true)
    expect(flags.force).toBe(true)
  })

  test('parses short -x flags', () => {
    const { flags } = parseArgs(['make:model', 'User', '-f'])
    expect(flags.f).toBe(true)
  })

  test('handles no args', () => {
    const { command, flags, positional } = parseArgs([])
    expect(command).toBeNull()
    expect(flags).toEqual({})
    expect(positional).toEqual([])
  })

  test('handles multiple positional args', () => {
    const { command, positional } = parseArgs(['make:model', 'User', 'extra'])
    expect(command).toBe('make:model')
    expect(positional).toEqual(['User', 'extra'])
  })

  test('parses --class=SeederName', () => {
    const { flags } = parseArgs(['db:seed', '--class=UserSeeder'])
    expect(flags.class).toBe('UserSeeder')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Name helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('toPascalCase', () => {
  test.each([
    ['user',             'User'],
    ['user_profile',     'UserProfile'],
    ['user-profile',     'UserProfile'],
    ['UserProfile',      'UserProfile'],
    ['create_users',     'CreateUsers'],
    ['my_long_name',     'MyLongName'],
  ])('%s → %s', (input, expected) => {
    expect(toPascalCase(input)).toBe(expected)
  })
})

describe('toCamelCase', () => {
  test.each([
    ['User',         'user'],
    ['UserProfile',  'userProfile'],
    ['user_profile', 'userProfile'],
    ['user-profile', 'userProfile'],
  ])('%s → %s', (input, expected) => {
    expect(toCamelCase(input)).toBe(expected)
  })
})

describe('toSnakeCase', () => {
  test.each([
    ['User',        'user'],
    ['UserProfile', 'user_profile'],
    ['user-profile','user_profile'],
    ['myLongName',  'my_long_name'],
    ['ABCTest',     'a_b_c_test'],
  ])('%s → %s', (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected)
  })
})

describe('toKebabCase', () => {
  test.each([
    ['User',        'user'],
    ['UserProfile', 'user-profile'],
    ['user_profile','user-profile'],
  ])('%s → %s', (input, expected) => {
    expect(toKebabCase(input)).toBe(expected)
  })
})

describe('toTableName', () => {
  test.each([
    ['User',     'users'],
    ['Post',     'posts'],
    ['Category', 'categories'],
    ['Address',  'addresses'],
    ['Box',      'boxes'],
    ['Wish',     'wishes'],
    ['Status',   'statuses'],
    ['Tax',      'taxes'],
    ['UserProfile', 'user_profiles'],
  ])('%s → %s', (input, expected) => {
    expect(toTableName(input)).toBe(expected)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// migrationTimestamp
// ─────────────────────────────────────────────────────────────────────────────
describe('migrationTimestamp', () => {
  test('returns a 14-digit numeric string', () => {
    const ts = migrationTimestamp()
    expect(ts).toMatch(/^\d{14}$/)
  })

  test('two consecutive calls produce same or increasing timestamps', () => {
    const a = migrationTimestamp()
    const b = migrationTimestamp()
    expect(Number(b)).toBeGreaterThanOrEqual(Number(a))
  })

  test('format is YYYYMMDDHHmmss', () => {
    const ts = migrationTimestamp()
    const year  = parseInt(ts.slice(0, 4))
    const month = parseInt(ts.slice(4, 6))
    const day   = parseInt(ts.slice(6, 8))
    expect(year).toBeGreaterThanOrEqual(2024)
    expect(month).toBeGreaterThanOrEqual(1)
    expect(month).toBeLessThanOrEqual(12)
    expect(day).toBeGreaterThanOrEqual(1)
    expect(day).toBeLessThanOrEqual(31)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// resolveConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveConfig', () => {
  test('returns defaults when no config present', () => {
    const cfg = resolveConfig({ config: null })
    expect(cfg.paths.models).toBe('app/models')
    expect(cfg.paths.migrations).toBe('database/migrations')
    expect(cfg.paths.seeders).toBe('database/seeders')
    expect(cfg.paths.factories).toBe('database/factories')
    expect(cfg.connection.driver).toBe('pgsql')
  })

  test('merges user config paths over defaults', () => {
    const cfg = resolveConfig({
      config: {
        paths: { models: 'src/models', migrations: 'src/migrations' },
      },
    })
    expect(cfg.paths.models).toBe('src/models')
    expect(cfg.paths.migrations).toBe('src/migrations')
    expect(cfg.paths.seeders).toBe('database/seeders')      // default preserved
    expect(cfg.paths.factories).toBe('database/factories')  // default preserved
  })

  test('merges user connection over defaults', () => {
    const cfg = resolveConfig({
      config: {
        connection: { driver: 'mongodb', url: 'mongodb://localhost' },
      },
    })
    expect(cfg.connection.driver).toBe('mongodb')
    expect(cfg.connection.url).toBe('mongodb://localhost')
  })

  test('passes through extra config keys', () => {
    const cfg = resolveConfig({
      config: { customKey: 'hello' },
    })
    expect(cfg.customKey).toBe('hello')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// scanMigrations
// ─────────────────────────────────────────────────────────────────────────────
describe('scanMigrations', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns empty array if directory does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    const result = scanMigrations('/some/path')
    expect(result).toEqual([])
  })

  test('returns sorted list of .js migration files', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue([
      '20240315120002_add_avatar.js',
      '20240315120001_create_posts.js',
      '20240315120000_create_users.js',
      'not-a-migration.txt',
    ])
    const result = scanMigrations('/migrations')
    expect(result).toHaveLength(3)
    expect(result[0].filename).toBe('20240315120000_create_users.js')
    expect(result[1].filename).toBe('20240315120001_create_posts.js')
    expect(result[2].filename).toBe('20240315120002_add_avatar.js')
  })

  test('extracts name from filename correctly', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['20240101000000_create_users_table.js'])
    const [mig] = scanMigrations('/migrations')
    expect(mig.name).toBe('create_users_table')
    expect(mig.filename).toBe('20240101000000_create_users_table.js')
  })

  test('includes full path', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['20240101000000_create_users.js'])
    const [mig] = scanMigrations('/app/migrations')
    expect(mig.path).toContain('20240101000000_create_users.js')
  })

  test('ignores non-.js files', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue([
      '20240101_migration.js',
      'README.md',
      '.gitkeep',
      '20240102_another.ts',
    ])
    const result = scanMigrations('/migrations')
    expect(result).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// scanSeeders
// ─────────────────────────────────────────────────────────────────────────────
describe('scanSeeders', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns empty array if directory does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(scanSeeders('/seeders')).toEqual([])
  })

  test('returns all .js files sorted', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['UserSeeder.js', 'DatabaseSeeder.js', 'PostSeeder.js'])
    const result = scanSeeders('/seeders')
    expect(result).toHaveLength(3)
    expect(result[0].name).toBe('DatabaseSeeder')
    expect(result[1].name).toBe('PostSeeder')
    expect(result[2].name).toBe('UserSeeder')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// writeFile helper
// ─────────────────────────────────────────────────────────────────────────────
describe('writeFile', () => {
  beforeEach(() => jest.clearAllMocks())

  test('writes file when it does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    const result = writeFile('/path/to/file.js', 'content')
    expect(mockFs.writeFileSync).toHaveBeenCalledWith('/path/to/file.js', 'content', 'utf8')
    expect(result).toBe(true)
  })

  test('skips when file exists and overwrite=false', () => {
    mockFs.existsSync.mockImplementation((p) => p === '/path/to/file.js')
    const result = writeFile('/path/to/file.js', 'content', { overwrite: false })
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })

  test('overwrites when file exists and overwrite=true', () => {
    mockFs.existsSync.mockImplementation((p) => p === '/path/to/file.js')
    const result = writeFile('/path/to/file.js', 'new content', { overwrite: true })
    expect(mockFs.writeFileSync).toHaveBeenCalled()
    expect(result).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// make:model — generated code shape
// ─────────────────────────────────────────────────────────────────────────────
describe('make:model generated content', () => {
  // We test the generators indirectly by examining what writeFile receives
  let capturedWrites = []

  beforeEach(() => {
    capturedWrites = []
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockImplementation(() => {})
    mockFs.writeFileSync.mockImplementation((path, content) => {
      capturedWrites.push({ path, content })
    })
  })

  async function runMakeModel(args) {
    const { parseArgs } = await import('../../packages/cli/src/utils.js')
    const { command, flags, positional } = parseArgs(args)
    const { cmdMakeModel } = await import('../../packages/cli/src/commands/make-model.js')
    await cmdMakeModel({ cwd: '/project', config: null, flags, positional })
    return capturedWrites
  }

  test('generates model with correct class name', async () => {
    const writes = await runMakeModel(['make:model', 'UserProfile'])
    const modelWrite = writes.find(w => w.path.includes('UserProfile.js'))
    expect(modelWrite).toBeDefined()
    expect(modelWrite.content).toContain('class UserProfile extends Model')
  })

  test('sets correct table name', async () => {
    const writes = await runMakeModel(['make:model', 'Post'])
    const modelWrite = writes.find(w => w.path.includes('Post.js'))
    expect(modelWrite.content).toContain("static table    = 'posts'")
  })

  test('--soft-deletes adds softDeletes flag', async () => {
    const writes = await runMakeModel(['make:model', 'Post', '--soft-deletes'])
    const modelWrite = writes.find(w => w.path.includes('Post.js'))
    expect(modelWrite.content).toContain('static softDeletes = true')
  })

  test('--migration generates migration file', async () => {
    const writes = await runMakeModel(['make:model', 'Post', '--migration'])
    const migWrite = writes.find(w => w.path.includes('create_posts_table'))
    expect(migWrite).toBeDefined()
    expect(migWrite.content).toContain("Schema.create('posts'")
    expect(migWrite.content).toContain('async up()')
    expect(migWrite.content).toContain('async down()')
  })

  test('--all generates model + migration + factory + seeder', async () => {
    const writes = await runMakeModel(['make:model', 'Article', '--all'])
    const paths = writes.map(w => w.path)
    expect(paths.some(p => p.includes('Article.js') && p.includes('models'))).toBe(true)
    expect(paths.some(p => p.includes('create_articles_table'))).toBe(true)
    expect(paths.some(p => p.includes('ArticleFactory.js'))).toBe(true)
    expect(paths.some(p => p.includes('ArticleSeeder.js'))).toBe(true)
  })

  test('generated migration references correct table', async () => {
    const writes = await runMakeModel(['make:model', 'BlogPost', '--migration'])
    const migWrite = writes.find(w => w.path.includes('create_blog_posts_table'))
    expect(migWrite).toBeDefined()
    expect(migWrite.content).toContain("Schema.create('blog_posts'")
  })

  test('generated factory imports the model', async () => {
    const writes = await runMakeModel(['make:model', 'Tag', '--factory'])
    const factoryWrite = writes.find(w => w.path.includes('TagFactory.js'))
    expect(factoryWrite).toBeDefined()
    expect(factoryWrite.content).toContain("import Tag from '../models/Tag.js'")
    expect(factoryWrite.content).toContain('class TagFactory extends Factory')
  })

  test('handles pascal-cased input name', async () => {
    const writes = await runMakeModel(['make:model', 'BlogPost'])
    const modelWrite = writes.find(w => w.path.includes('BlogPost.js'))
    expect(modelWrite.content).toContain('class BlogPost extends Model')
    expect(modelWrite.content).toContain("static table    = 'blog_posts'")
  })

  test('handles kebab-cased input name', async () => {
    const writes = await runMakeModel(['make:model', 'blog-post'])
    const modelWrite = writes.find(w => w.path.includes('BlogPost.js'))
    expect(modelWrite.content).toContain('class BlogPost extends Model')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// make:migration — smart template detection
// ─────────────────────────────────────────────────────────────────────────────
describe('make:migration smart template detection', () => {
  let capturedWrites = []

  beforeEach(() => {
    capturedWrites = []
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockImplementation(() => {})
    mockFs.writeFileSync.mockImplementation((path, content) => {
      capturedWrites.push({ path, content })
    })
  })

  async function runMakeMigration(name) {
    const { cmdMakeMigration } = await import('../../packages/cli/src/commands/make-migration.js')
    await cmdMakeMigration({ cwd: '/project', config: null, flags: {}, positional: [name] })
    return capturedWrites[0]
  }

  test('create_users_table → CREATE TABLE template', async () => {
    const w = await runMakeMigration('create_users_table')
    expect(w.content).toContain("Schema.create('users'")
    expect(w.content).toContain('async up()')
    expect(w.content).toContain("Schema.dropIfExists('users')")
  })

  test('add_avatar_to_users → ALTER TABLE ADD template', async () => {
    const w = await runMakeMigration('add_avatar_to_users')
    expect(w.content).toContain("Schema.table('users'")
    expect(w.content).toContain('avatar')
  })

  test('drop_bio_from_profiles → ALTER TABLE DROP template', async () => {
    const w = await runMakeMigration('drop_bio_from_profiles')
    expect(w.content).toContain("Schema.table('profiles'")
    expect(w.content).toContain('dropColumn')
  })

  test('rename_posts_to_articles → RENAME TABLE template', async () => {
    const w = await runMakeMigration('rename_posts_to_articles')
    expect(w.content).toContain("Schema.rename('posts', 'articles')")
    expect(w.content).toContain("Schema.rename('articles', 'posts')")
  })

  test('drop_old_logs_table → DROP TABLE template', async () => {
    const w = await runMakeMigration('drop_old_logs_table')
    expect(w.content).toContain("Schema.dropIfExists('old_logs')")
  })

  test('unknown name → generic template', async () => {
    const w = await runMakeMigration('some_custom_operation')
    expect(w.content).toContain('async up()')
    expect(w.content).toContain('async down()')
    expect(w.content).toContain('Write your migration here')
  })

  test('filename includes timestamp prefix', async () => {
    const w = await runMakeMigration('create_tags_table')
    expect(w.path).toMatch(/\d{14}_create_tags_table\.js$/)
  })

  test('class name is PascalCase from snake', async () => {
    const w = await runMakeMigration('create_user_profiles_table')
    expect(w.content).toContain('class CreateUserProfilesTable extends Migration')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// make:seeder
// ─────────────────────────────────────────────────────────────────────────────
describe('make:seeder', () => {
  let capturedWrites = []

  beforeEach(() => {
    capturedWrites = []
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockImplementation(() => {})
    mockFs.writeFileSync.mockImplementation((path, content) => {
      capturedWrites.push({ path, content })
    })
  })

  test('generates seeder with correct class name', async () => {
    const { cmdMakeSeeder } = await import('../../packages/cli/src/commands/make-seeder.js')
    await cmdMakeSeeder({ cwd: '/project', config: null, flags: {}, positional: ['User'] })
    const w = capturedWrites[0]
    expect(w.path).toContain('UserSeeder.js')
    expect(w.content).toContain('class UserSeeder extends Seeder')
    expect(w.content).toContain('async run()')
  })

  test('strips duplicate Seeder suffix from input', async () => {
    const { cmdMakeSeeder } = await import('../../packages/cli/src/commands/make-seeder.js')
    await cmdMakeSeeder({ cwd: '/project', config: null, flags: {}, positional: ['UserSeeder'] })
    const w = capturedWrites[0]
    expect(w.path).toContain('UserSeeder.js')
    expect(w.content).not.toContain('class UserSeederSeeder')
  })

  test('handles kebab-cased names', async () => {
    const { cmdMakeSeeder } = await import('../../packages/cli/src/commands/make-seeder.js')
    await cmdMakeSeeder({ cwd: '/project', config: null, flags: {}, positional: ['blog-post'] })
    const w = capturedWrites[0]
    expect(w.path).toContain('BlogPostSeeder.js')
    expect(w.content).toContain('class BlogPostSeeder extends Seeder')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// make:factory
// ─────────────────────────────────────────────────────────────────────────────
describe('make:factory', () => {
  let capturedWrites = []

  beforeEach(() => {
    capturedWrites = []
    jest.clearAllMocks()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockImplementation(() => {})
    mockFs.writeFileSync.mockImplementation((path, content) => {
      capturedWrites.push({ path, content })
    })
  })

  test('generates factory with correct class name', async () => {
    const { cmdMakeFactory } = await import('../../packages/cli/src/commands/make-factory.js')
    await cmdMakeFactory({ cwd: '/project', config: null, flags: {}, positional: ['User'] })
    const w = capturedWrites[0]
    expect(w.path).toContain('UserFactory.js')
    expect(w.content).toContain('class UserFactory extends Factory')
    expect(w.content).toContain('definition()')
  })

  test('strips duplicate Factory suffix from input', async () => {
    const { cmdMakeFactory } = await import('../../packages/cli/src/commands/make-factory.js')
    await cmdMakeFactory({ cwd: '/project', config: null, flags: {}, positional: ['UserFactory'] })
    const w = capturedWrites[0]
    expect(w.path).toContain('UserFactory.js')
    expect(w.content).not.toContain('class UserFactoryFactory')
  })

  test('imports the model correctly', async () => {
    const { cmdMakeFactory } = await import('../../packages/cli/src/commands/make-factory.js')
    await cmdMakeFactory({ cwd: '/project', config: null, flags: {}, positional: ['Post'] })
    const w = capturedWrites[0]
    expect(w.content).toContain("import Post from '../models/Post.js'")
    expect(w.content).toContain('model = Post')
  })

  test('imports faker', async () => {
    const { cmdMakeFactory } = await import('../../packages/cli/src/commands/make-factory.js')
    await cmdMakeFactory({ cwd: '/project', config: null, flags: {}, positional: ['Post'] })
    const w = capturedWrites[0]
    expect(w.content).toContain("from '@faker-js/faker'")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// init — config and directory generation
// ─────────────────────────────────────────────────────────────────────────────
describe('init command', () => {
  let capturedWrites = []
  let createdDirs = []

  beforeEach(() => {
    capturedWrites = []
    createdDirs = []
    jest.clearAllMocks()
    // package.json exists with type:module already
    mockFs.existsSync.mockImplementation((p) => p.endsWith('package.json'))
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ type: 'module' }))
    mockFs.mkdirSync.mockImplementation((p) => createdDirs.push(p))
    mockFs.writeFileSync.mockImplementation((path, content) => capturedWrites.push({ path, content }))
  })

  test('creates eloquent.config.js', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await cmdInit({ cwd: '/project', config: null, flags: {}, positional: [] })
    const configWrite = capturedWrites.find(w => w.path.endsWith('eloquent.config.js'))
    expect(configWrite).toBeDefined()
    expect(configWrite.content).toContain('export default')
    expect(configWrite.content).toContain('connection')
    expect(configWrite.content).toContain('paths')
  })

  test('default config uses pgsql driver', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await cmdInit({ cwd: '/project', config: null, flags: {}, positional: [] })
    const configWrite = capturedWrites.find(w => w.path.endsWith('eloquent.config.js'))
    expect(configWrite.content).toContain("driver:   'pgsql'")
  })

  test('--driver=mongodb uses mongodb config', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await cmdInit({ cwd: '/project', config: null, flags: { driver: 'mongodb' }, positional: [] })
    const configWrite = capturedWrites.find(w => w.path.endsWith('eloquent.config.js'))
    expect(configWrite.content).toContain("driver:   'mongodb'")
    expect(configWrite.content).toContain('MONGO_URL')
  })

  test('creates DatabaseSeeder', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await cmdInit({ cwd: '/project', config: null, flags: {}, positional: [] })
    const seederWrite = capturedWrites.find(w => w.path.includes('DatabaseSeeder.js'))
    expect(seederWrite).toBeDefined()
    expect(seederWrite.content).toContain('class DatabaseSeeder extends Seeder')
  })

  test('creates .env.example', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await cmdInit({ cwd: '/project', config: null, flags: {}, positional: [] })
    const envWrite = capturedWrites.find(w => w.path.endsWith('.env.example'))
    expect(envWrite).toBeDefined()
    expect(envWrite.content).toContain('DB_HOST')
  })

  test('throws for invalid driver', async () => {
    const { cmdInit } = await import('../../packages/cli/src/commands/init.js')
    await expect(
      cmdInit({ cwd: '/project', config: null, flags: { driver: 'sqlite' }, positional: [] })
    ).rejects.toThrow('Unknown driver')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// db:wipe — requires --force
// ─────────────────────────────────────────────────────────────────────────────
describe('db:wipe', () => {
  test('exits without --force', async () => {
    const { cmdDbWipe } = await import('../../packages/cli/src/commands/db-wipe.js')
    await expect(
      cmdDbWipe({ cwd: '/project', config: null, flags: {}, positional: [] })
    ).rejects.toThrow('process.exit(1)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// colors
// ─────────────────────────────────────────────────────────────────────────────
describe('colors', () => {
  test('contains ANSI escape codes', () => {
    expect(colors.reset).toContain('\x1b[')
    expect(colors.green).toContain('\x1b[')
    expect(colors.red).toContain('\x1b[')
    expect(colors.cyan).toContain('\x1b[')
  })

  test('reset code terminates color sequences', () => {
    const colored = `${colors.green}text${colors.reset}`
    expect(colored).toContain('\x1b[0m')
  })
})
