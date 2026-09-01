/**
 * @eloquentjs/mcp — Unit Tests
 *
 * Tests the protocol layer, all tool definitions, help/docs tools,
 * and the NLP query/CRUD parsers. No DB, no filesystem, no MCP SDK needed
 * for the pure logic tests.
 */

import { jest } from '@jest/globals'

// ─── Mock fs so filesystem tools don't hit disk ───────────────────────────────
const mockFs = {
  existsSync:   jest.fn().mockReturnValue(false),
  readdirSync:  jest.fn().mockReturnValue([]),
  writeFileSync: jest.fn(),
  mkdirSync:    jest.fn(),
  readFileSync: jest.fn(),
}
jest.unstable_mockModule('fs', () => mockFs)

// ─── Import modules ───────────────────────────────────────────────────────────
const { MessageParser, encodeMessage, makeResult, makeError,
        makeNotification, ErrorCode } =
  await import('../../packages/mcp/src/protocol.js')

const { handleGetHelp, handleGetMethodSignature, handleGetExamples,
        handleNlpQuery, handleNlpCrud, helpTools } =
  await import('../../packages/mcp/src/tools/help.js')

const { introspectTools } = await import('../../packages/mcp/src/tools/introspect.js')
const { generateTools }   = await import('../../packages/mcp/src/tools/generate.js')
const { queryTools }      = await import('../../packages/mcp/src/tools/query.js')
const { ALL_TOOLS }       = await import('../../packages/mcp/src/tools/index.js')

const emptyCtx = { cwd: '/project', config: null, flags: {}, positional: [] }

// ─────────────────────────────────────────────────────────────────────────────
// Protocol — MessageParser
// ─────────────────────────────────────────────────────────────────────────────
describe('MessageParser', () => {
  test('parses a complete Content-Length framed message', () => {
    const parser = new MessageParser()
    const body   = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
    const frame  = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    const msgs   = parser.push(Buffer.from(frame))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].method).toBe('ping')
    expect(msgs[0].id).toBe(1)
  })

  test('handles chunked delivery', () => {
    const parser = new MessageParser()
    const body   = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const frame  = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    const mid    = Math.floor(frame.length / 2)
    const part1  = parser.push(Buffer.from(frame.slice(0, mid)))
    const part2  = parser.push(Buffer.from(frame.slice(mid)))
    expect(part1).toHaveLength(0)  // incomplete
    expect(part2).toHaveLength(1)  // now complete
    expect(part2[0].method).toBe('tools/list')
  })

  test('parses two messages in one chunk', () => {
    const parser  = new MessageParser()
    const make    = (id) => {
      const body  = JSON.stringify({ jsonrpc: '2.0', id, method: 'ping', params: {} })
      return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`
    }
    const msgs = parser.push(Buffer.from(make(1) + make(2)))
    expect(msgs).toHaveLength(2)
    expect(msgs[0].id).toBe(1)
    expect(msgs[1].id).toBe(2)
  })

  test('returns empty array when message is incomplete', () => {
    const parser = new MessageParser()
    const msgs   = parser.push(Buffer.from('Content-Length: 100\r\n\r\n{'))
    expect(msgs).toHaveLength(0)
  })

  test('handles unicode body correctly', () => {
    const parser = new MessageParser()
    const body   = JSON.stringify({ text: '日本語テスト 🎉' })
    const bytes  = Buffer.byteLength(body, 'utf8')
    const frame  = `Content-Length: ${bytes}\r\n\r\n${body}`
    const msgs   = parser.push(Buffer.from(frame, 'utf8'))
    expect(msgs).toHaveLength(1)
    expect(msgs[0].text).toBe('日本語テスト 🎉')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Protocol — encodeMessage / makeResult / makeError
// ─────────────────────────────────────────────────────────────────────────────
describe('Protocol helpers', () => {
  test('encodeMessage produces Content-Length framed buffer', () => {
    const msg = makeResult(1, { ok: true })
    const buf = encodeMessage(msg)
    const str = buf.toString('utf8')
    expect(str).toMatch(/^Content-Length: \d+\r\n\r\n/)
    expect(str).toContain('"result"')
    expect(str).toContain('"ok":true')
  })

  test('makeResult has correct jsonrpc structure', () => {
    const msg = makeResult(42, { data: 'hello' })
    expect(msg.jsonrpc).toBe('2.0')
    expect(msg.id).toBe(42)
    expect(msg.result.data).toBe('hello')
  })

  test('makeError has correct jsonrpc error structure', () => {
    const msg = makeError(5, ErrorCode.MethodNotFound, 'Method not found')
    expect(msg.jsonrpc).toBe('2.0')
    expect(msg.id).toBe(5)
    expect(msg.error.code).toBe(ErrorCode.MethodNotFound)
    expect(msg.error.message).toBe('Method not found')
  })

  test('makeNotification has no id field', () => {
    const msg = makeNotification('initialized', {})
    expect(msg.jsonrpc).toBe('2.0')
    expect(msg.method).toBe('initialized')
    expect(msg.id).toBeUndefined()
  })

  test('ErrorCode values are negative integers', () => {
    expect(ErrorCode.ParseError).toBe(-32700)
    expect(ErrorCode.MethodNotFound).toBe(-32601)
    expect(ErrorCode.InvalidParams).toBe(-32602)
    expect(ErrorCode.InternalError).toBe(-32603)
    expect(ErrorCode.ServerError).toBe(-32000)
  })

  test('encodeMessage is round-trippable through MessageParser', () => {
    const parser  = new MessageParser()
    const original = makeResult(99, { foo: 'bar', nested: { x: 1 } })
    const buf      = encodeMessage(original)
    const msgs     = parser.push(buf)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual(original)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions — schema validation
// ─────────────────────────────────────────────────────────────────────────────
describe('Tool definitions', () => {
  test('ALL_TOOLS has 21 tools', () => {
    expect(ALL_TOOLS).toHaveLength(21)
  })

  test('every tool has name, description, and inputSchema', () => {
    for (const tool of ALL_TOOLS) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  test('tool names are unique', () => {
    const names = ALL_TOOLS.map(t => t.name)
    const unique = new Set(names)
    expect(unique.size).toBe(names.length)
  })

  test('introspect tools include all 5', () => {
    const names = introspectTools.map(t => t.name)
    expect(names).toContain('list_models')
    expect(names).toContain('describe_model')
    expect(names).toContain('list_migrations')
    expect(names).toContain('describe_database_schema')
    expect(names).toContain('get_project_structure')
  })

  test('generate tools include all 5', () => {
    const names = generateTools.map(t => t.name)
    expect(names).toContain('generate_model')
    expect(names).toContain('generate_migration')
    expect(names).toContain('generate_graphql_schema')
    expect(names).toContain('generate_typescript_types')
    expect(names).toContain('generate_openapi_spec')
  })

  test('query tools include all 6', () => {
    const names = queryTools.map(t => t.name)
    expect(names).toContain('query_model')
    expect(names).toContain('run_raw_query')
    expect(names).toContain('run_migrations')
    expect(names).toContain('rollback_migration')
    expect(names).toContain('migration_status')
    expect(names).toContain('run_seeder')
  })

  test('help tools include all 5', () => {
    const names = helpTools.map(t => t.name)
    expect(names).toContain('get_help')
    expect(names).toContain('get_method_signature')
    expect(names).toContain('get_examples')
    expect(names).toContain('nlp_query')
    expect(names).toContain('nlp_crud')
  })

  test('generate_model has required fields', () => {
    const tool = generateTools.find(t => t.name === 'generate_model')
    expect(tool.inputSchema.required).toContain('name')
    expect(tool.inputSchema.properties.withMigration).toBeDefined()
    expect(tool.inputSchema.properties.write).toBeDefined()
  })

  test('query_model caps at 100 rows (documented in description)', () => {
    const tool = queryTools.find(t => t.name === 'query_model')
    expect(tool.description).toContain('100')
  })

  test('run_raw_query documents SELECT-only restriction', () => {
    const tool = queryTools.find(t => t.name === 'run_raw_query')
    expect(tool.description.toLowerCase()).toContain('select')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// get_help tool
// ─────────────────────────────────────────────────────────────────────────────
describe('handleGetHelp', () => {
  test('returns docs for known topic', async () => {
    const result = await handleGetHelp({ topic: 'model' }, emptyCtx)
    expect(result.topic).toBe('model')
    expect(result.summary).toBeTruthy()
    expect(result.description).toBeTruthy()
    expect(result.quickStart).toBeTruthy()
    expect(result.seeAlso).toBeInstanceOf(Array)
  })

  test('returns docs for query-builder', async () => {
    const result = await handleGetHelp({ topic: 'query-builder' }, emptyCtx)
    expect(result.topic).toBe('query-builder')
    expect(result.quickStart).toContain('paginate')
    expect(result.quickStart).toContain('where')
  })

  test('returns docs for soft-deletes', async () => {
    const result = await handleGetHelp({ topic: 'soft-deletes' }, emptyCtx)
    expect(result.quickStart).toContain('withTrashed')
    expect(result.quickStart).toContain('onlyTrashed')
    expect(result.quickStart).toContain('restore')
  })

  test('returns docs for validation', async () => {
    const result = await handleGetHelp({ topic: 'validation' }, emptyCtx)
    expect(result.quickStart).toContain('Validator')
    expect(result.quickStart).toContain('schema')
  })

  test('returns docs for graphql', async () => {
    const result = await handleGetHelp({ topic: 'graphql' }, emptyCtx)
    expect(result.quickStart).toContain('buildSchema')
  })

  test('returns docs for realtime', async () => {
    const result = await handleGetHelp({ topic: 'realtime' }, emptyCtx)
    expect(result.quickStart).toContain('createRealtimeServer')
    expect(result.quickStart).toContain('broadcastFrom')
  })

  test('returns docs for mcp', async () => {
    const result = await handleGetHelp({ topic: 'mcp' }, emptyCtx)
    expect(result.quickStart).toContain('eloquent-mcp')
  })

  test('error on unknown topic', async () => {
    const result = await handleGetHelp({ topic: 'unknown-thing' }, emptyCtx)
    expect(result.error).toBeTruthy()
    expect(result.availableTopics).toBeInstanceOf(Array)
    expect(result.availableTopics.length).toBeGreaterThan(5)
  })

  test('search mode finds matching topics', async () => {
    const result = await handleGetHelp({ search: 'delete' }, emptyCtx)
    expect(result.matches).toBeInstanceOf(Array)
    expect(result.matches.length).toBeGreaterThan(0)
    expect(result.matches.some(m => m.topic.includes('delete') || m.topic.includes('soft'))).toBe(true)
  })

  test('search mode returns hint when no matches', async () => {
    const result = await handleGetHelp({ search: 'zxqwerty99notexist' }, emptyCtx)
    expect(result.matches).toHaveLength(0)
    expect(result.hint).toBeTruthy()
  })

  test('all 13 topics return valid docs', async () => {
    const topics = ['model','query-builder','relations','casts','scopes','hooks',
                    'events','soft-deletes','validation','migrations','graphql','api','realtime','mcp']
    for (const topic of topics) {
      const result = await handleGetHelp({ topic }, emptyCtx)
      expect(result.error).toBeUndefined()
      expect(result.quickStart).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// get_method_signature tool
// ─────────────────────────────────────────────────────────────────────────────
describe('handleGetMethodSignature', () => {
  test('returns signature for Model.find', async () => {
    const result = await handleGetMethodSignature({ method: 'Model.find' }, emptyCtx)
    expect(result.sig).toContain('find(')
    expect(result.returns).toContain('Promise')
    expect(result.desc).toBeTruthy()
  })

  test('returns signature for model.update', async () => {
    const result = await handleGetMethodSignature({ method: 'model.update' }, emptyCtx)
    expect(result.sig).toContain('update(')
  })

  test('returns signature for hasMany', async () => {
    const result = await handleGetMethodSignature({ method: 'hasMany' }, emptyCtx)
    expect(result.sig).toContain('hasMany(')
    expect(result.returns).toContain('Relation')
  })

  test('returns signature for paginate', async () => {
    const result = await handleGetMethodSignature({ method: 'paginate' }, emptyCtx)
    expect(result.sig).toContain('paginate(')
    expect(result.returns).toContain('Promise')
  })

  test('fuzzy match on partial name', async () => {
    const result = await handleGetMethodSignature({ method: 'findOrFail' }, emptyCtx)
    // Handles both direct hit (result.sig) and fuzzy matches (result.matches[].sig or .signature)
    const sigValue = result.sig ?? result.signature
      ?? result.matches?.map(m => m.sig ?? m.signature).find(Boolean) ?? ''
    expect(sigValue).toContain('findOrFail')
  })

  test('returns error for unknown method', async () => {
    const result = await handleGetMethodSignature({ method: 'completelyUnknownMethod' }, emptyCtx)
    expect(result.error).toBeTruthy()
    expect(result.allMethods).toBeInstanceOf(Array)
    expect(result.allMethods.length).toBeGreaterThan(20)
  })

  test('all method entries have required fields', async () => {
    const methods = ['Model.find','Model.create','model.delete','hasMany','belongsTo','paginate']
    for (const m of methods) {
      const r = await handleGetMethodSignature({ method: m }, emptyCtx)
      const hasSig  = !!(r.sig ?? r.signature ?? r.matches?.[0]?.sig ?? r.matches?.[0]?.signature)
      const hasDesc = !!(r.desc ?? r.description ?? r.matches?.[0]?.desc ?? r.matches?.[0]?.description)
      expect(hasSig).toBe(true)
      expect(hasDesc).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// get_examples tool
// ─────────────────────────────────────────────────────────────────────────────
describe('handleGetExamples', () => {
  test('returns pagination example', async () => {
    const result = await handleGetExamples({ topic: 'pagination' }, emptyCtx)
    expect(result.code).toContain('paginate(')
    expect(result.code).toContain('meta')
  })

  test('returns eager-loading example', async () => {
    const result = await handleGetExamples({ topic: 'eager-loading' }, emptyCtx)
    expect(result.code).toContain('.with(')
  })

  test('returns transactions example', async () => {
    const result = await handleGetExamples({ topic: 'transactions' }, emptyCtx)
    expect(result.code).toContain('transaction(')
    expect(result.code).toContain('ROLLBACK')
  })

  test('returns soft-deletes example', async () => {
    const result = await handleGetExamples({ topic: 'soft-deletes' }, emptyCtx)
    expect(result.code).toContain('withTrashed')
    expect(result.code).toContain('restore()')
  })

  test('returns validation example', async () => {
    const result = await handleGetExamples({ topic: 'validation' }, emptyCtx)
    expect(result.code).toContain('schema')
    expect(result.code).toContain('parseAsync')
  })

  test('returns factory example', async () => {
    const result = await handleGetExamples({ topic: 'factory' }, emptyCtx)
    expect(result.code).toContain('Factory')
    expect(result.code).toContain('faker')
    expect(result.code).toContain('.create()')
  })

  test('error on unknown topic', async () => {
    const result = await handleGetExamples({ topic: 'does-not-exist' }, emptyCtx)
    expect(result.error).toBeTruthy()
    expect(result.availableTopics).toBeInstanceOf(Array)
  })

  test('all example topics return runnable code', async () => {
    const topics = ['pagination', 'eager-loading', 'transactions', 'soft-deletes', 'validation', 'factory']
    for (const t of topics) {
      const r = await handleGetExamples({ topic: t }, emptyCtx)
      expect(r.error).toBeUndefined()
      expect(r.code.length).toBeGreaterThan(50)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nlp_query tool — pure NLP parsing (no DB)
// ─────────────────────────────────────────────────────────────────────────────
describe('handleNlpQuery', () => {
  test('parses simple model query', async () => {
    const result = await handleNlpQuery({ query: 'get all User records' }, emptyCtx)
    expect(result.generatedCode).toContain('User')
    expect(result.generatedCode).toContain('.get()')
    expect(result.naturalLanguage).toBeTruthy()
  })

  test('parses "active" filter', async () => {
    const result = await handleNlpQuery({ query: 'get active User records' }, emptyCtx)
    expect(result.generatedCode).toContain("where('active'")
    expect(result.generatedCode).toContain('true')
  })

  test('parses "most recent" order', async () => {
    const result = await handleNlpQuery({ query: 'get 5 most recent Post records' }, emptyCtx)
    expect(result.generatedCode).toContain('orderBy')
    expect(result.generatedCode).toContain('desc')
    expect(result.generatedCode).toContain('limit(5)')
  })

  test('parses eager load with', async () => {
    const result = await handleNlpQuery({ query: 'get User records with their posts' }, emptyCtx)
    expect(result.generatedCode).toContain(".with('posts')")
  })

  test('parses count aggregate', async () => {
    const result = await handleNlpQuery({ query: 'count all admin User records' }, emptyCtx)
    expect(result.generatedCode).toContain('.count()')
    expect(result.generatedCode).toContain("where('is_admin'")
  })

  test('parses "this week" time filter', async () => {
    const result = await handleNlpQuery({ query: 'get User records created this week' }, emptyCtx)
    expect(result.generatedCode).toContain("where('created_at'")
    expect(result.generatedCode).toContain('>=')
  })

  test('parses "today" time filter', async () => {
    const result = await handleNlpQuery({ query: 'get Post records from today' }, emptyCtx)
    expect(result.generatedCode).toContain("where('created_at'")
  })

  test('parses "oldest" order', async () => {
    const result = await handleNlpQuery({ query: 'get oldest User records' }, emptyCtx)
    expect(result.generatedCode).toContain('asc')
  })

  test('returns parsed object alongside code', async () => {
    const result = await handleNlpQuery({ query: 'get 10 active User records' }, emptyCtx)
    expect(result.parsed).toBeDefined()
    expect(result.parsed.model).toBe('User')
    expect(result.parsed.limit).toBe(10)
  })

  test('returns suggestions when model undetected', async () => {
    const result = await handleNlpQuery({ query: 'get things with stuff' }, emptyCtx)
    expect(result.suggestions).toBeInstanceOf(Array)
    expect(result.suggestions.length).toBeGreaterThan(0)
  })

  test('does not execute when execute is false', async () => {
    const result = await handleNlpQuery({ query: 'get all User records', execute: false }, emptyCtx)
    expect(result.executed).toBeUndefined()
  })

  // The README's own `nlp_query` examples are all-lowercase, plural nouns —
  // "get the 10 most recent active users with their posts", "find posts
  // created today ordered by title" — never a capitalized singular model
  // name. Matching only `/\b([A-Z][a-zA-Z]+)\b/` in the raw text means every
  // documented example failed to parse a model at all.
  describe('lowercase plural model names, as used in every README example', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readdirSync.mockReturnValue(['User.js', 'Post.js', 'Comment.js', 'index.js'])
    })
    afterEach(() => {
      mockFs.existsSync.mockReturnValue(false)
      mockFs.readdirSync.mockReturnValue([])
    })

    test('resolves a plural noun to its model, exactly like the README examples', async () => {
      const result = await handleNlpQuery({ query: 'get the 10 most recent active users with their posts' }, emptyCtx)
      expect(result.parsed.model).toBe('User')
      expect(result.generatedCode).toContain('User')
    })

    test('"find posts created today ordered by title" resolves to Post', async () => {
      const result = await handleNlpQuery({ query: 'find posts created today ordered by title' }, emptyCtx)
      expect(result.parsed.model).toBe('Post')
    })

    test('does not mistake the models/index.js barrel for a model name', async () => {
      const result = await handleNlpQuery({ query: 'count all comments' }, emptyCtx)
      expect(result.parsed.model).toBe('Comment')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// nlp_crud tool
// ─────────────────────────────────────────────────────────────────────────────
describe('handleNlpCrud', () => {
  test('parses create instruction', async () => {
    const result = await handleNlpCrud({
      instruction: 'create a User named Alice with email alice@example.com',
    }, emptyCtx)
    expect(result.operation).toBe('create')
    expect(result.generatedCode).toContain('User.create')
    expect(result.generatedCode).toContain('Alice')
    expect(result.generatedCode).toContain('alice@example.com')
  })

  test('parses update instruction', async () => {
    const result = await handleNlpCrud({
      instruction: 'update User 42 set is_admin to true',
    }, emptyCtx)
    expect(result.operation).toBe('update')
    expect(result.generatedCode).toContain('findOrFail(42)')
    expect(result.generatedCode).toContain('.update(')
  })

  test('parses delete instruction with id', async () => {
    const result = await handleNlpCrud({
      instruction: 'delete User 7',
    }, emptyCtx)
    expect(result.operation).toBe('delete')
    expect(result.generatedCode).toContain('findOrFail(7)')
    expect(result.generatedCode).toContain('.delete()')
  })

  test('parses find instruction', async () => {
    const result = await handleNlpCrud({
      instruction: 'find User 5',
    }, emptyCtx)
    expect(result.operation).toBe('find')
    expect(result.generatedCode).toContain('findOrFail(5)')
  })

  test('parses "add" as create', async () => {
    const result = await handleNlpCrud({
      instruction: 'add a new Post with title Hello World',
    }, emptyCtx)
    expect(result.operation).toBe('create')
    expect(result.generatedCode).toContain('.create(')
  })

  test('parses "remove" as delete', async () => {
    const result = await handleNlpCrud({
      instruction: 'remove User 3',
    }, emptyCtx)
    expect(result.operation).toBe('delete')
  })

  test('all results include explanation', async () => {
    const instructions = [
      'create a User named Test',
      'update User 1',
      'delete User 2',
      'find User 3',
    ]
    for (const instruction of instructions) {
      const r = await handleNlpCrud({ instruction }, emptyCtx)
      expect(r.explanation).toBeTruthy()
      expect(r.generatedCode).toBeTruthy()
    }
  })

  test('execute mode returns safety warning', async () => {
    const result = await handleNlpCrud({
      instruction: 'create a User named Test',
      execute: true,
    }, emptyCtx)
    expect(result.warning).toBeTruthy()
    expect(result.warning.toLowerCase()).toContain('safe')
  })

  test('result includes note about reviewing code', async () => {
    const result = await handleNlpCrud({
      instruction: 'create a Post',
    }, emptyCtx)
    expect(result.note).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// run_raw_query — safety check
// ─────────────────────────────────────────────────────────────────────────────
describe('handleRunRawQuery safety', () => {
  test('rejects INSERT statement', async () => {
    const { handleRunRawQuery } = await import('../../packages/mcp/src/tools/query.js')
    await expect(
      handleRunRawQuery({ sql: "INSERT INTO users VALUES ('hack')" }, emptyCtx)
    ).rejects.toThrow(/SELECT/)
  })

  test('rejects UPDATE statement', async () => {
    const { handleRunRawQuery } = await import('../../packages/mcp/src/tools/query.js')
    await expect(
      handleRunRawQuery({ sql: 'UPDATE users SET is_admin = true' }, emptyCtx)
    ).rejects.toThrow(/SELECT/)
  })

  test('rejects DROP statement', async () => {
    const { handleRunRawQuery } = await import('../../packages/mcp/src/tools/query.js')
    await expect(
      handleRunRawQuery({ sql: 'DROP TABLE users' }, emptyCtx)
    ).rejects.toThrow(/SELECT/)
  })

  test('rejects DELETE statement', async () => {
    const { handleRunRawQuery } = await import('../../packages/mcp/src/tools/query.js')
    await expect(
      handleRunRawQuery({ sql: 'DELETE FROM users WHERE 1=1' }, emptyCtx)
    ).rejects.toThrow(/SELECT/)
  })
})
