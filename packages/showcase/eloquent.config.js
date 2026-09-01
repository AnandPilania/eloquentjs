/**
 * EloquentJS Configuration — driver-switchable via DB_DRIVER env var, so the
 * same app/models and database/migrations get exercised against pgsql,
 * sqlite and mongodb from one codebase.
 */

const driver = process.env.DB_DRIVER ?? 'sqlite'

const connections = {
  pgsql: {
    driver:   'pgsql',
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_DATABASE ?? 'eloquentjs_showcase',
    user:     process.env.DB_USERNAME ?? 'root',
    password: process.env.DB_PASSWORD ?? 'root',
  },
  sqlite: {
    driver:   'sqlite',
    database: process.env.SQLITE_DATABASE ?? './database.sqlite',
  },
  mongodb: {
    driver:   'mongodb',
    url:      process.env.MONGO_URL      ?? 'mongodb://localhost:27017',
    database: process.env.MONGO_DATABASE ?? 'eloquentjs_showcase',
    username: process.env.MONGO_USERNAME ?? 'root',
    password: process.env.MONGO_PASSWORD ?? 'secret',
    authSource: process.env.MONGO_AUTH_SOURCE ?? 'admin',
  },
}

export default {
  connection: connections[driver],

  paths: {
    models:     'app/models',
    migrations: 'database/migrations',
    seeders:    'database/seeders',
    factories:  'database/factories',
  },
}
