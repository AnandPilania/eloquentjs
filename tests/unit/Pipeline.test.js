/**
 * Unit tests — Pipeline, Factory, Seeder
 */

import { Pipeline } from '../../packages/core/src/Pipeline.js'
import { Factory }  from '../../packages/core/src/Factory.js'
import { Seeder }   from '../../packages/core/src/Factory.js'
import { Model }    from '../../packages/core/src/Model.js'
import { setResolver, clearResolvers } from '../../packages/core/src/ConnectionRegistry.js'

// ─── Pipeline ────────────────────────────────────────────────────────────────
describe('Pipeline', () => {
  test('passes payload through a sequence of plain functions', async () => {
    const result = await Pipeline
      .send({ value: 1 })
      .through(
        d => ({ ...d, value: d.value + 1 }),
        d => ({ ...d, value: d.value * 10 }),
        d => ({ ...d, done: true }),
      )
      .thenReturn()

    expect(result.value).toBe(20)
    expect(result.done).toBe(true)
  })

  test('handles async functions', async () => {
    const result = await Pipeline
      .send('hello')
      .through(
        async s => s + ' world',
        async s => s.toUpperCase(),
      )
      .thenReturn()

    expect(result).toBe('HELLO WORLD')
  })

  test('handles class pipes with .handle() method', async () => {
    class AddStep {
      async handle(d) { return { ...d, value: d.value + 5 } }
    }
    class MultiplyStep {
      async handle(d) { return { ...d, value: d.value * 2 } }
    }

    const result = await Pipeline
      .send({ value: 10 })
      .through(new AddStep(), new MultiplyStep())
      .thenReturn()

    expect(result.value).toBe(30)
  })

  test('pipe() appends additional steps', async () => {
    const result = await Pipeline
      .send(0)
      .through(n => n + 1)
      .pipe(n => n + 2)
      .thenReturn()

    expect(result).toBe(3)
  })

  test('is awaitable as a thenable', async () => {
    const result = await Pipeline.send(5).through(n => n * n)
    expect(result).toBe(25)
  })

  test('empty pipe returns payload unchanged', async () => {
    const data = { x: 42 }
    const result = await Pipeline.send(data).through().thenReturn()
    expect(result).toBe(data)
  })

  test('short-circuit is possible by throwing', async () => {
    await expect(
      Pipeline
        .send({ value: 0 })
        .through(
          async d => { if (d.value === 0) throw new Error('zero not allowed'); return d },
          async d => ({ ...d, done: true }),
        )
        .thenReturn()
    ).rejects.toThrow('zero not allowed')
  })
})

// ─── Factory ──────────────────────────────────────────────────────────────────
describe('Factory', () => {
  let insertedRows
  let mockResolver

  class Post extends Model {
    static table    = 'posts'
    static fillable = ['title', 'body', 'user_id', 'published']
    static timestamps = false
    static guarded = []
  }

  class PostFactory extends Factory {
    static model = Post

    definition() {
      return {
        title:     'Sample Post',
        body:      'Lorem ipsum',
        user_id:   1,
        published: false,
      }
    }
  }

  beforeEach(() => {
    insertedRows = []
    mockResolver = {
      async insert(table, data) {
        const row = { id: insertedRows.length + 1, ...data }
        insertedRows.push(row)
        return row
      },
      async select() { return [] },
      async aggregate() { return 0 },
      async update() { return 1 },
      async delete() { return 1 },
    }
    clearResolvers()
    setResolver(mockResolver)
  })

  test('make() returns a model instance without persisting', async () => {
    const post = await PostFactory.new().make()
    expect(post).toBeInstanceOf(Post)
    expect(post.existsInDb()).toBe(false)
    expect(insertedRows).toHaveLength(0)
  })

  test('create() persists the model', async () => {
    const post = await PostFactory.new().create()
    expect(post).toBeInstanceOf(Post)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].title).toBe('Sample Post')
  })

  test('count(n) creates n records', async () => {
    const posts = await PostFactory.new().count(3).create()
    expect(Array.isArray(posts)).toBe(true)
    expect(posts).toHaveLength(3)
    expect(insertedRows).toHaveLength(3)
  })

  test('count(1) returns a single model (not array)', async () => {
    const post = await PostFactory.new().count(1).create()
    expect(post).toBeInstanceOf(Post)
  })

  test('state() merges overrides into definition', async () => {
    const post = await PostFactory.new()
      .state({ published: true, title: 'Published' })
      .create()

    expect(insertedRows[0].published).toBe(true)
    expect(insertedRows[0].title).toBe('Published')
  })

  test('state(function) receives current attrs and merges', async () => {
    const post = await PostFactory.new()
      .state(attrs => ({ title: attrs.title.toUpperCase() }))
      .create()

    expect(insertedRows[0].title).toBe('SAMPLE POST')
  })

  test('create(overrides) merges overrides', async () => {
    const post = await PostFactory.new().create({ title: 'Override' })
    expect(insertedRows[0].title).toBe('Override')
  })

  test('make(overrides) merges overrides without persisting', async () => {
    const post = await PostFactory.new().make({ user_id: 99 })
    expect(post.getRawAttribute('user_id')).toBe(99)
    expect(insertedRows).toHaveLength(0)
  })

  test('afterCreating() callback runs after insert', async () => {
    const created = []
    await PostFactory.new()
      .afterCreating(post => created.push(post.getRawAttribute('id')))
      .create()

    expect(created).toHaveLength(1)
    expect(created[0]).toBe(1)
  })

  test('afterMaking() callback runs after make()', async () => {
    const made = []
    await PostFactory.new()
      .afterMaking(post => made.push(post.getRawAttribute('title')))
      .make()

    expect(made).toHaveLength(1)
    expect(made[0]).toBe('Sample Post')
  })

  test('chained state + count + afterCreating', async () => {
    const ids = []
    await PostFactory.new()
      .count(2)
      .state({ published: true })
      .afterCreating(p => ids.push(p.getRawAttribute('id')))
      .create()

    expect(insertedRows).toHaveLength(2)
    expect(ids).toHaveLength(2)
    expect(insertedRows.every(r => r.published === true)).toBe(true)
  })

  test('definition() is called freshly each create', async () => {
    let counter = 0
    class CountingFactory extends Factory {
      static model = Post
      definition() { return { title: `Post ${++counter}`, body: 'x', user_id: 1, published: false } }
    }

    const posts = await CountingFactory.new().count(3).create()
    const titles = insertedRows.map(r => r.title)
    // Each definition() call should produce unique titles
    expect(new Set(titles).size).toBe(3)
  })
})

// ─── Seeder ───────────────────────────────────────────────────────────────────
describe('Seeder', () => {
  test('call() runs each seeder in order', async () => {
    const order = []

    class ASeeder extends Seeder {
      async run() { order.push('A') }
    }
    class BSeeder extends Seeder {
      async run() { order.push('B') }
    }
    class CSeeder extends Seeder {
      async run() { order.push('C') }
    }

    class DatabaseSeeder extends Seeder {
      async run() {
        await this.call(ASeeder, BSeeder, CSeeder)
      }
    }

    await new DatabaseSeeder().run()
    expect(order).toEqual(['A', 'B', 'C'])
  })

  test('call() also accepts instances', async () => {
    const order = []

    class MySeeder extends Seeder {
      async run() { order.push('done') }
    }

    class RootSeeder extends Seeder {
      async run() { await this.call(new MySeeder()) }
    }

    await new RootSeeder().run()
    expect(order).toEqual(['done'])
  })

  test('run() throws if not overridden', async () => {
    const s = new Seeder()
    await expect(s.run()).rejects.toThrow()
  })
})
