# EloquentJS Demo

A small example project that uses the local workspace packages via
`file:../packages/*` links.

## Important: install from the repository root first

This demo links to the local `@eloquentjs/*` packages with `file:` paths, which
npm installs as **symlinks**. Node resolves a symlinked package's own
dependencies from its real location inside `packages/…`, *not* from
`demo/node_modules`. As a result, running `npm install` **only** inside `demo/`
does not install the driver's dependency (`pg`), and you get:

```
✖ Error: Cannot connect to database: Driver package @eloquentjs/pgsql is not installed.
```

The fix is to install the workspace at the repository root once, so every
package's dependencies (including `pg`) are installed and the symlinks resolve:

```bash
# from the repo root (one level up)
cd ..
npm install            # installs all workspace packages + their deps (pg, etc.)

# then run the demo
cd demo
npm install            # links the local packages into the demo
npm run migrate
```

> Once the packages are published to npm, you can instead point the demo's
> dependencies at the published versions (e.g. `"@eloquentjs/pgsql": "^0.0.4"`)
> and `npm install` inside `demo/` will work on its own.

## Configuration

Database settings come from `.env` (copied from `.env.example`). The `migrate`
and `seed` scripts load it with Node's built-in `--env-file`, so no extra
tooling is required (needs Node 20.6+):

```jsonc
"migrate": "node --env-file=.env node_modules/@eloquentjs/cli/bin/eloquent.js migrate"
```

Point `.env` at a running PostgreSQL instance, for example the one in your
`docker-compose`:

```env
DB_HOST=localhost
DB_PORT=5432
DB_DATABASE=movies_api_db
DB_USERNAME=postgres
DB_PASSWORD=postgres
```

## Commands

```bash
npm run migrate    # run pending migrations
npm run seed       # run seeders
```

## Prefer SQLite for a zero-setup demo?

If you don't want to run a database server, switch the driver to SQLite — no
external service required:

```bash
# from the repo root
npm install   # ensures @eloquentjs/sqlite + better-sqlite3 are available
```

```js
// eloquent.config.js
export default {
  connection: { driver: 'sqlite', database: './database.sqlite' },
  paths: { models: 'app/models', migrations: 'database/migrations', seeders: 'database/seeders' },
}
```
