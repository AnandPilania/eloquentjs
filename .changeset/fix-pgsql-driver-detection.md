---
"@eloquentjs/pgsql": patch
"@eloquentjs/cli": patch
---

Fix false "Driver package @eloquentjs/pgsql is not installed" error on
`eloquent migrate` (issue #1).

`@eloquentjs/pgsql` now declares its `pg` dependency, so a fresh install pulls
it in automatically. The CLI's connection loader no longer maps every
`ERR_MODULE_NOT_FOUND` to "driver not installed": it identifies the actual
missing module and reports it (e.g. "@eloquentjs/pgsql is installed, but its
dependency 'pg' is missing. Run: npm install pg"), and it no longer
misattributes real connection failures to a missing package.

Also fixes the `@eloquentjs/pgsql` manifest (removed a self-referential
dependency and a broken relative `file:` path) and the `@eloquentjs/cli`
manifest (corrected `file:` workspace paths that broke `npm install`). The CLI
banner now reads its version from `package.json` instead of a hardcoded string.
