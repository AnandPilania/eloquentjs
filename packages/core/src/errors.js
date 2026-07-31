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
  constructor(field) {
    super(`Field "${field}" is not fillable`)
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
  constructor(model, relation) {
    super(`Relation "${relation}" not found on model "${model}"`)
    this.name = 'RelationNotFoundException'
  }
}
