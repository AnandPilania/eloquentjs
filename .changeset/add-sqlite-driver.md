---
"@eloquentjs/sqlite": minor
"@eloquentjs/cli": minor
---

Add `@eloquentjs/sqlite` — a SQLite driver built on `better-sqlite3`.

Implements the full core resolver contract (CRUD, aggregates, increment,
pivot/belongs-to-many, has-many-through, schema builder, transactions, raw)
against a file-backed or in-memory SQLite database. SQLite-specific behaviour
is handled correctly: positional `?` placeholders, `INTEGER PRIMARY KEY
AUTOINCREMENT`, inline foreign-key constraints, `PRAGMA foreign_keys`, boolean
and `Date` parameter normalization, and `strftime`-based date helpers.

The CLI now recognises `sqlite` (and the `sqlite3` alias) as a connection
driver, including `eloquent init --driver=sqlite`. `@eloquentjs/mcp` picks up
SQLite support automatically through the shared connection loader.
