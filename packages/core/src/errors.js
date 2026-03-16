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

export class RelationNotFoundException extends Error {
  constructor(model, relation) {
    super(`Relation "${relation}" not found on model "${model}"`)
    this.name = 'RelationNotFoundException'
  }
}
