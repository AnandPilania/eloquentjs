/**
 * EloquentJS Configuration
 *
 * This file is loaded by the CLI (eloquent.config.js) and by your app
 * to configure database connections and file paths.
 */

export default {
    // ─── Database connection ─────────────────────────────────────────────────
    connection: {
        driver: 'pgsql',
        host: process.env.DB_HOST ?? 'localhost',
        port: Number(process.env.DB_PORT ?? 5432),
        database: process.env.DB_DATABASE ?? 'myapp',
        user: process.env.DB_USERNAME ?? 'root',
        password: process.env.DB_PASSWORD ?? 'secret',
        ssl: process.env.DB_SSL === 'true',
    },

    // ─── File paths ──────────────────────────────────────────────────────────
    paths: {
        models: 'app/models',
        migrations: 'database/migrations',
        seeders: 'database/seeders',
        factories: 'database/factories',
    },
}
