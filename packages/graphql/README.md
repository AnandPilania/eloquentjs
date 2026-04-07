# @eloquentjs/graphql

> Auto-generate a complete GraphQL schema and resolvers from your EloquentJS models. Works with Apollo Server, GraphQL Yoga, Mercurius, and any spec-compliant GraphQL server.

```bash
npm install @eloquentjs/core @eloquentjs/codegen @eloquentjs/graphql graphql
```

> **Powered by [`@eloquentjs/codegen`](../codegen):** SDL generation is handled by the shared codegen engine, ensuring consistency with TypeScript types, OpenAPI specs, and CLI-generated schema files.

---

## Two Ways to Build a Schema

### 1. From live Model classes

```js
import { buildSchema } from '@eloquentjs/graphql'
import { ApolloServer } from '@apollo/server'
import { User, Post, Comment } from './models/index.js'

const { typeDefs, resolvers } = buildSchema([User, Post, Comment])
const server = new ApolloServer({ typeDefs, resolvers })
```

### 2. From a models directory (auto-loads all model files)

```js
import { buildSchemaFromDir } from '@eloquentjs/graphql'

const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models', {
  auth: async (ctx) => authenticateUser(ctx),
})
const server = new ApolloServer({ typeDefs, resolvers })
```

### 3. Write schema.graphql to disk (CLI)

```bash
# Requires @eloquentjs/cli and @eloquentjs/codegen
eloquent generate:graphql
eloquent generate:graphql --pagination=relay --out=src/schema.graphql
eloquent generate:graphql --models=User,Post --no-subscriptions
```

---

## Generated Schema

Given a `User` model with `casts = { name: 'string', is_admin: 'boolean' }`:

```graphql
scalar JSON
scalar DateTime

type User {
  id: ID
  name: String
  is_admin: Boolean
  created_at: DateTime
  updated_at: DateTime
}

input CreateUserInput { name: String  is_admin: Boolean }
input UpdateUserInput { name: String  is_admin: Boolean }
input UserWhereInput  { id: ID  name: String  AND: [UserWhereInput]  OR: [UserWhereInput] }

type UserPage { data: [User!]!  meta: PaginationMeta! }

type Query {
  user(id: ID!): User
  users(where: UserWhereInput, orderBy: String, orderDir: String, page: Int, perPage: Int): UserPage
  usersCount(where: UserWhereInput): Int!
}

type Mutation {
  createUser(input: CreateUserInput!): User!
  updateUser(id: ID!, input: UpdateUserInput!): User!
  deleteUser(id: ID!): Boolean!
  upsertUser(where: UserWhereInput!, input: CreateUserInput!): User!
}

type Subscription {
  userCreated: User!
  userUpdated: User!
  userDeleted: ID!
}
```

For models with `softDeletes = true`, also generates `restoreUser` and `forceDeleteUser` mutations.

---

## Options

```js
const { typeDefs, resolvers } = buildSchema([User, Post, Comment], {
  pagination:    'offset',     // 'offset' (default) | 'relay'
  subscriptions: true,
  auth: async (ctx) => {
    const token = ctx.req.headers.authorization?.replace('Bearer ', '')
    return token ? User.where('api_token', token).firstOrFail() : null
  },
  scalars: ['Upload', 'BigInt'],
})
```

---

## Per-Model Configuration

```js
class Post extends Model {
  static graphql = {
    fields:       { secret_hash: false, internal_notes: false },  // hide fields
    queries:      { deletePost: false, forceDeletePost: false },   // disable operations
    subscription: false,                                           // no subscriptions
    middleware:   [requireAuth, logQuery],                         // per-resolver middleware
  }
}
```

---

## Relay Pagination

```js
const { typeDefs, resolvers } = buildSchema([User], { pagination: 'relay' })
// type UserEdge { node: User!  cursor: String! }
// type UserConnection { edges: [UserEdge!]!  pageInfo: PageInfo!  totalCount: Int! }
```

---

## Extending Auto-Generated Resolvers

```js
const { typeDefs, resolvers } = buildSchema([User, Post], { auth })

resolvers.Query.feed = async (_, { page = 1, perPage = 10 }, ctx) => {
  return Post.published().with('user', 'tags').latest().paginate(page, perPage)
}

resolvers.Mutation.likePost = async (_, { postId }, ctx) => {
  if (!ctx.user) throw new Error('Unauthorized')
  await Like.updateOrCreate(
    { likeable_type: 'Post', likeable_id: postId, user_id: ctx.user.id }, {}
  )
  return Post.find(postId)
}

resolvers.User.postsCount = async (parent) => Post.where('user_id', parent.id).count()
```

---

## With GraphQL Yoga

```js
import { createYoga } from 'graphql-yoga'
import { buildSchema } from '@eloquentjs/graphql'

const { typeDefs, resolvers } = buildSchema([User, Post])
const yoga = createYoga({ typeDefs, resolvers })
server.use('/graphql', yoga)
```

## With Mercurius (Fastify)

```js
import Fastify from 'fastify'
import mercurius from 'mercurius'
import { buildSchema } from '@eloquentjs/graphql'

const app = Fastify()
const { typeDefs, resolvers } = buildSchema([User, Post])
app.register(mercurius, { schema: typeDefs, resolvers })
```

---

## Using Codegen Directly

For advanced use — generate SDL without resolvers, inspect field types, or combine with TypeScript generation:

```js
import { introspect, generateGraphqlSchema, generateTypeScriptFile } from '@eloquentjs/codegen'

const schemas = [User, Post].map(introspect)

// SDL only (no resolvers)
const sdl = generateGraphqlSchema(schemas, { pagination: 'relay' })

// TypeScript types from the same schema objects
const types = generateTypeScriptFile(schemas)
```

See the [`@eloquentjs/codegen` README](../codegen/README.md) for the full API.

---

## License

MIT
