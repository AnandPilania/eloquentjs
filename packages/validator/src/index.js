/**
 * @eloquentjs/validator — Public API
 *
 * Three ways to validate:
 *
 * 1. Laravel-style rules object (compatible with @eloquentjs/core Validator):
 *    import { Validator } from '@eloquentjs/validator'
 *    const v = Validator.make(data, { email: ['required', 'email'] })
 *    if (v.fails()) throw new Error()
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
 * 5. DB-backed rules (async):
 *    import { Rule } from '@eloquentjs/validator'
 *    const rules = { email: ['required', 'email', Rule.unique('users', 'email')] }
 *    await Validator.make(data, rules).validatedAsync()
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
