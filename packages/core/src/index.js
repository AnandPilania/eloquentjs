/**
 * @eloquentjs/core — Public API
 */

// Connection management
export { setResolver, getResolver, hasResolver, removeResolver, clearResolvers } from './ConnectionRegistry.js'

// Model base class + errors
export { Model, withScopes }                from './Model.js'
export { ModelNotFoundException,
         MassAssignmentException,
         ValidationException,
         RelationNotFoundException }         from './errors.js'

// Query builder + Collection
export { QueryBuilder }                      from './QueryBuilder.js'
export { Collection }                        from './Collection.js'

// Schema + Migrations
export { Schema, Migration, Blueprint }      from './Schema.js'

// Events + Hooks
export { EventEmitter }                      from './EventEmitter.js'
export { HookRegistry }                      from './HookRegistry.js'

// Casts
export { CastRegistry, DateCast, JsonCast, BooleanCast } from './CastRegistry.js'

// Relations
export { RelationRegistry, ModelRegistry }   from './relations/RelationRegistry.js'

// Utilities
export { Pipeline }                          from './Pipeline.js'
export { Validator }                         from './Validator.js'
export { Factory }                           from './Factory.js'
export { Seeder }                            from './Factory.js'
