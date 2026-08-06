/**
 * @eloquentjs/validator — Public API
 *
 * Five ways to validate:
 *
 * 1. Laravel-style rules, as an array or the pipe string (this subclasses
 *    @eloquentjs/core's Validator, so every rule has one implementation):
 *    import { Validator } from '@eloquentjs/validator'
 *    const v = Validator.make(data, { email: 'required|email' })
 *    if (v.fails()) throw new ValidationException(v.errors)
 *
 * 2. Fluent schema API (like Zod):
 *    import { v } from '@eloquentjs/validator'
 *    const schema = v.schema({ email: v.string().email() })
 *    const data = schema.parse(input)
 *
 * 3. Named rule functions:
 *    import { required, email, min } from '@eloquentjs/validator/rules'
 *    const rules = { email: [required(), email(), min(5)] }
 *
 * 4. Framework adapters:
 *    import { expressValidate } from '@eloquentjs/validator/adapters'
 *    router.post('/users', expressValidate(rules), handler)
 *
 * 5. DB-backed rules. `unique` and `exists` hit the database, so they only run
 *    under validateAsync()/validatedAsync() — the sync path skips them rather
 *    than reporting them as passed. They no longer fail open: a database error
 *    surfaces instead of being swallowed into "valid".
 *    import { Rule } from '@eloquentjs/validator'
 *    const rules = { email: ['required', 'email', Rule.unique('users', 'email')] }
 *    await Validator.make(data, rules).validatedAsync()
 *
 *    // Or as a string rule: unique:table,column[,ignoreId[,ignoreColumn]]
 *    { email: ['required', `unique:users,email,${user.id}`] }
 */

// Core Validator (extends @eloquentjs/core Validator)
export { Validator, validate, validateAsync } from './Validator.js'

// Fluent schema API
export { v, Schema,
         StringSchema, NumberSchema, BooleanSchema,
         DateSchema, ArraySchema, ObjectSchema } from './Schema.js'

// Rule base class + DB rule factories
export { Rule, UniqueRule, ExistsRule } from './Rule.js'

// Re-export ValidationException from core for convenience
export { ValidationException } from '@eloquentjs/core'
