/**
 * @eloquentjs/core — Shared string utilities
 *
 * Single source of truth for all string transformations used across the
 * monorepo.  Import from here; do NOT re-declare locally in other packages.
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
 * Infer a snake_case foreign key from a Model class name.
 *   User        → user_id
 *   UserProfile → user_profile_id
 */
export function inferForeignKey(ModelClass) {
    return `${toSnakeCase(ModelClass.name)}_id`
}
