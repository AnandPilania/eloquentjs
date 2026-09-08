/**
 * @eloquentjs/core — Error Classes
 */

export class ModelNotFoundException extends Error {
  constructor(message) {
    super(message)
    this.name = 'ModelNotFoundException'
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor)
  }
}

export class MassAssignmentException extends Error {
  /** Callers pass one fully-formatted message describing the problem. */
  constructor(message) {
    super(message)
    this.name = 'MassAssignmentException'
  }
}

export class ValidationException extends Error {
  constructor(errors) {
    super('The given data was invalid.')
    this.name = 'ValidationException'
    this.errors = errors
  }
}

/** Authorization failure — @eloquentjs/api maps this to HTTP 403. */
export class PolicyException extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'PolicyException'
  }
}

export class RelationNotFoundException extends Error {
  /** Callers pass one fully-formatted message describing the problem. */
  constructor(message) {
    super(message)
    this.name = 'RelationNotFoundException'
  }
}

/**
 * Thrown when `Model.preventLazyLoading()` is on and code reads a relation
 * that was not eager-loaded — Laravel Eloquent 9's equivalent guard.
 */
export class LazyLoadingViolationError extends Error {
  constructor(model, relation) {
    super(`Attempted to lazy load [${relation}] relation on model [${model}] but lazy loading is disabled.`)
    this.name = 'LazyLoadingViolationError'
  }
}
