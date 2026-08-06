/**
 * @eloquentjs/core — Public API
 */

// Connection management
export {
    setResolver, getResolver, hasResolver, removeResolver, clearResolvers,
    runInTransaction, inTransaction, activeTransactionResolver,
} from './ConnectionRegistry.js'
export { DB } from './DB.js'

// Model base class + errors
export { Model, withScopes, Attribute } from './Model.js'
export {
    ModelNotFoundException,
    MassAssignmentException,
    ValidationException,
    PolicyException,
    RelationNotFoundException
} from './errors.js'

// Query builder + Collection
export { QueryBuilder } from './QueryBuilder.js'
export { Collection } from './Collection.js'

// Schema + Migrations
export { Schema, Migration, Blueprint, Expr } from './Schema.js'

// Events + Hooks
export { EventEmitter } from './EventEmitter.js'
export { HookRegistry } from './HookRegistry.js'

// Casts
export {
    CastRegistry, DateCast, JsonCast, BooleanCast, AsEnum, AsCollection, AsArrayObject, verifyHashed,
} from './CastRegistry.js'

// Relations
export { RelationRegistry, ModelRegistry } from './relations/RelationRegistry.js'

// Utilities
export { Pipeline } from './Pipeline.js'
export { Validator } from './Validator.js'
export { Factory } from './Factory.js'
export { Seeder } from './Factory.js'

// String / naming utilities (shared across monorepo)
export {
    toSnakeCase, toSnakePlural, toPascalCase, toCamelCase, toKebabCase,
    inferForeignKey, indexName, foreignKeyName,
    assertOperator, SQL_OPERATORS,
} from './utils.js'
