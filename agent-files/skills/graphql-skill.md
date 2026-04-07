# EloquentJS GraphQL Skill

## When to use this skill
Use when generating or customising a GraphQL API from EloquentJS models with `@eloquentjs/graphql`.

---

## Quick Setup

```bash
npm install @eloquentjs/core @eloquentjs/codegen @eloquentjs/graphql graphql
```

```js
import { buildSchema } from '@eloquentjs/graphql'
import { ApolloServer } from '@apollo/server'

const { typeDefs, resolvers } = buildSchema([User, Post, Comment], {
  pagination:    'offset',      // 'offset' | 'relay'
  subscriptions: true,
  auth: async (ctx) => {
    const token = ctx.req?.headers?.authorization?.replace('Bearer ', '')
    if (!token) throw new Error('Unauthenticated')
    return User.where('api_token', token).firstOrFail()
  },
})

const server = new ApolloServer({ typeDefs, resolvers })
```

---

## Auto-Generated Schema

Given a `User` model with `casts = { name: 'string', is_admin: 'boolean', score: 'integer' }`:

```graphql
type User {
  id: ID
  name: String
  is_admin: Boolean
  score: Int
  created_at: DateTime
  updated_at: DateTime
}

input CreateUserInput { name: String  is_admin: Boolean  score: Int }
input UpdateUserInput { name: String  is_admin: Boolean  score: Int }
input UserWhereInput  { id: ID  name: String  AND: [UserWhereInput]  OR: [UserWhereInput] }
type UserPage         { data: [User!]!  meta: PaginationMeta! }

type Query {
  user(id: ID!): User
  users(where: UserWhereInput, orderBy: String, orderDir: String, page: Int, perPage: Int): UserPage!
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

For models with `static softDeletes = true`, also generates `restoreUser` and `forceDeleteUser`.

---

## Per-Model GraphQL Config

```js
class Post extends Model {
  static graphql = {
    // Hide specific fields from the GraphQL type
    fields: {
      internal_hash: false,
      secret_token:  false,
    },

    // Disable specific generated operations
    queries: {
      deletePost:      false,   // no deletePost mutation
      forceDeletePost: false,
    },

    // Disable subscriptions for this model only
    subscription: false,

    // Per-resolver middleware (runs before each resolver for this model)
    middleware: [requireAuth, logQuery, rateLimiter],
  }
}
```

---

## Options Reference

| Option | Default | Description |
|---|---|---|
| `pagination` | `'offset'` | `'offset'` — `UserPage { data, meta }` or `'relay'` — `UserConnection { edges, pageInfo }` |
| `subscriptions` | `true` | Generate `Subscription` type with `Created`/`Updated`/`Deleted` events |
| `auth` | `null` | Auth guard function `async (ctx) => user \| throw` |
| `scalars` | `[]` | Extra custom scalars to declare |

---

## Extending Auto-Generated Resolvers

```js
const { typeDefs, resolvers } = buildSchema([User, Post], { auth })

// Add custom query
resolvers.Query.feed = async (_, { page = 1, perPage = 10 }, ctx) => {
  return Post.published().with('user', 'tags').latest().paginate(page, perPage)
}

// Add custom mutation
resolvers.Mutation.publishPost = async (_, { id }, ctx) => {
  const post = await Post.findOrFail(id)
  await post.update({ status: 'published', published_at: new Date() })
  return post
}

// Add type-level resolver (computed field)
resolvers.User.postsCount = async (parent) => {
  return Post.where('user_id', parent.id).count()
}
```

---

## Relay Pagination

```js
const { typeDefs, resolvers } = buildSchema([User], { pagination: 'relay' })

// Generates:
// type UserEdge { node: User!  cursor: String! }
// type UserConnection { edges: [UserEdge!]!  pageInfo: PageInfo!  totalCount: Int! }
// query: users(...): UserConnection!
```

---

## Auto-Load From Directory

```js
// Loads all .js model files from the directory — no imports needed
import { buildSchemaFromDir } from '@eloquentjs/graphql'
const { typeDefs, resolvers } = await buildSchemaFromDir('./app/models')
```

---

## CLI: Generate Schema File

```bash
eloquent generate:graphql                           # all models → schema.graphql
eloquent generate:graphql --out=src/schema.graphql  # custom output path
eloquent generate:graphql --pagination=relay         # Relay cursor pagination
eloquent generate:graphql --models=User,Post         # specific models only
eloquent generate:graphql --no-subscriptions         # skip Subscription type
```

---

## With GraphQL Yoga

```js
import { createYoga } from 'graphql-yoga'
const { typeDefs, resolvers } = buildSchema([User, Post])
const yoga = createYoga({ typeDefs, resolvers })
app.use('/graphql', yoga)
```

## With Mercurius (Fastify)

```js
import mercurius from 'mercurius'
const { typeDefs, resolvers } = buildSchema([User, Post])
app.register(mercurius, { schema: typeDefs, resolvers })
```

---

## Type Mapping (casts → GraphQL types)

| Cast | GraphQL Type |
|---|---|
| `integer` / `biginteger` | `Int` |
| `float` / `double` / `decimal` | `Float` |
| `string` / `text` | `String` |
| `boolean` | `Boolean` |
| `date` / `datetime` / `timestamp` | `DateTime` |
| `json` / `jsonb` / `array` | `JSON` |
| `uuid` | `ID` |
| (primary key) | `ID` |
