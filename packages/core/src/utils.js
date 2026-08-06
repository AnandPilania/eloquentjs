/**
 * @eloquentjs/core — Shared string utilities
 *
 * Single source of truth for all string transformations used across the
 * monorepo.  Import from here; do NOT re-declare locally in other packages.
 *
 * This rule was broken in four places at once: @eloquentjs/graphql, the
 * codegen GraphQL/OpenAPI templates and @eloquentjs/realtime each had their own
 * `+ 's'` pluraliser, so REST said `/categories` while GraphQL said `categorys`
 * and the WebSocket channel was `categorys` too. They all call
 * `toSnakePlural()` now — including Model's Proxy, which had an inline
 * `toPascal` that disagreed with `toPascalCase` on hyphenated keys.
 */

/**
 * Convert a PascalCase or camelCase string to snake_case.
 *   UserProfile → user_profile
 *   XMLParser   → x_m_l_parser  (all-caps sequences stay joined via the
 *                                 caller passing e.g. 'XmlParser' instead)
 */
export function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, m => `_${m.toLowerCase()}`)
        .replace(/^_/, '')
        .replace(/[-\s]+/g, '_')
}

/**
 * Convert a PascalCase class name to a snake_plural table name.
 *   User        → users
 *   UserProfile → user_profiles
 *   Category    → categories
 *   Box / Dish  → boxes / dishes
 *   Day         → days      (vowel before -y keeps the y)
 *
 * Regular English plurals only — irregulars (Person → people, Mouse → mice)
 * still need `static table`.
 */
export function toSnakePlural(name) {
    const snake = toSnakeCase(name)
    if (/[^aeiou]y$/.test(snake)) return snake.slice(0, -1) + 'ies'
    if (/(s|x|z|ch|sh)$/.test(snake)) return snake + 'es'
    return snake + 's'
}

/**
 * Convert a snake_case or kebab-case string to PascalCase.
 *   user_profile → UserProfile
 *   make-model   → MakeModel
 */
export function toPascalCase(str) {
    return str
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map(s => s[0].toUpperCase() + s.slice(1))
        .join('')
}

/**
 * Convert a snake_case string to camelCase.
 *   user_profile → userProfile
 */
export function toCamelCase(str) {
    const pascal = toPascalCase(str)
    return pascal[0].toLowerCase() + pascal.slice(1)
}

/**
 * Convert a PascalCase class name to a kebab-case slug.
 *   UserProfile → user-profile
 */
export function toKebabCase(str) {
    return toSnakeCase(str).replace(/_/g, '-')
}

/**
 * The only comparison operators that may reach a driver's SQL string.
 * Drivers interpolate the operator (it cannot be a bound parameter), so this
 * whitelist is the boundary that keeps `where(col, req.query.op, v)` from
 * becoming an injection point. Same list Laravel's Builder enforces.
 */
export const SQL_OPERATORS = new Set([
    '=', '<', '>', '<=', '>=', '<>', '!=', '<=>',
    'LIKE', 'NOT LIKE', 'ILIKE', 'NOT ILIKE', 'LIKE BINARY',
    '&', '|', '^', '<<', '>>', '&~',
    'RLIKE', 'NOT RLIKE', 'REGEXP', 'NOT REGEXP',
    '~', '~*', '!~', '!~*', 'SIMILAR TO', 'NOT SIMILAR TO',
])

/**
 * Normalise and validate a comparison operator.
 * @param {string} operator
 * @returns {string} the canonical upper-case operator
 * @throws {Error} when the operator is not whitelisted
 */
export function assertOperator(operator) {
    if (typeof operator !== 'string') {
        throw new Error(`[EloquentJS] Invalid operator: ${JSON.stringify(operator)}`)
    }
    const op = operator.trim().toUpperCase().replace(/\s+/g, ' ')
    if (!SQL_OPERATORS.has(op)) {
        throw new Error(
            `[EloquentJS] Unsupported operator "${operator}". ` +
            `Allowed: ${[...SQL_OPERATORS].join(', ')}. Use whereRaw() for anything else.`
        )
    }
    return op
}

/**
 * Canonical constraint names, shared by every driver so that a migration
 * written against one and rolled back against another still matches.
 *   users + email          → users_email_index / users_email_unique
 *   posts + user_id        → posts_user_id_foreign
 */
export function indexName(table, { columns = [], type = 'index' } = {}) {
    return `${table}_${columns.join('_')}_${type}`
}

export function foreignKeyName(table, column) {
    return `${table}_${column}_foreign`
}

/**
 * Infer a snake_case foreign key from a Model class name.
 *   User        → user_id
 *   UserProfile → user_profile_id
 */
export function inferForeignKey(ModelClass) {
    return `${toSnakeCase(ModelClass.name)}_id`
}
