/**
 * @eloquentjs/validator — Framework Adapters
 *
 * Drop-in middleware for Express and Fastify that validate request body,
 * query params, params, or headers using Validator rules or a Schema.
 */

import { Validator } from '../Validator.js'
import { ValidationException } from '@eloquentjs/core'

// ─── Express middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that validates req.body against rules.
 * On failure, calls next(ValidationException) or responds with 422.
 *
 * Usage:
 *   import { expressValidate } from '@eloquentjs/validator/adapters'
 *
 *   router.post('/users',
 *     expressValidate({
 *       name:  ['required', 'string', 'min:2'],
 *       email: ['required', 'email'],
 *     }),
 *     async (req, res) => {
 *       // req.validated — only the validated fields
 *       const user = await User.create(req.validated)
 *       res.json(user)
 *     }
 *   )
 *
 * With schema:
 *   import { v } from '@eloquentjs/validator'
 *   router.post('/users', expressValidate(
 *     v.schema({ name: v.string().min(2), email: v.string().email() })
 *   ), handler)
 *
 * Validate query params:
 *   expressValidate(rules, { source: 'query' })
 *
 * Async validation (unique/exists):
 *   expressValidate(rules, { async: true })
 */
export function expressValidate(rulesOrSchema, options = {}) {
  const {
    source       = 'body',    // 'body' | 'query' | 'params' | 'headers'
    async: isAsync = false,
    errorHandler = defaultExpressErrorHandler,
    messages     = {},
  } = options

  return async (req, res, next) => {
    const data = req[source] ?? {}

    let validator
    if (isSchemaObject(rulesOrSchema)) {
      const { rules, messages: msgs, attributes } = rulesOrSchema.toValidatorArgs()
      validator = Validator.make(data, rules, { ...msgs, ...messages }, attributes)
    } else {
      validator = Validator.make(data, rulesOrSchema, messages)
    }

    try {
      let passed
      if (isAsync) {
        passed = await validator.passesAsync()
      } else {
        passed = validator.passes()
      }

      if (!passed) {
        return errorHandler(new ValidationException(validator.errors), req, res, next)
      }

      // Attach validated subset to request
      req.validated = isAsync
        ? await validator.validatedAsync().catch(() => validator._extractValidated())
        : validator.validated()

      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Express error middleware that handles ValidationException.
 * Mount this after your routes.
 *
 * Usage:
 *   app.use(validationErrorHandler)
 */
export function validationErrorHandler(err, req, res, next) {
  if (err.name === 'ValidationException') {
    return res.status(422).json({
      message: 'The given data was invalid.',
      errors:  err.errors,
    })
  }
  next(err)
}

function defaultExpressErrorHandler(err, req, res, next) {
  return res.status(422).json({
    message: 'The given data was invalid.',
    errors:  err.errors,
  })
}

// ─── Fastify hook ─────────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook factory that validates request data.
 *
 * Usage:
 *   import { fastifyValidate } from '@eloquentjs/validator/adapters'
 *
 *   fastify.post('/users', {
 *     preHandler: fastifyValidate({
 *       name:  ['required', 'string', 'min:2'],
 *       email: ['required', 'email'],
 *     })
 *   }, async (req, reply) => {
 *     const user = await User.create(req.validated)
 *     reply.send(user)
 *   })
 *
 * Async:
 *   preHandler: fastifyValidate(schema, { async: true })
 */
export function fastifyValidate(rulesOrSchema, options = {}) {
  const {
    source       = 'body',
    async: isAsync = false,
    messages     = {},
  } = options

  return async (req, reply) => {
    const data = req[source] ?? {}

    let validator
    if (isSchemaObject(rulesOrSchema)) {
      const { rules, messages: msgs, attributes } = rulesOrSchema.toValidatorArgs()
      validator = Validator.make(data, rules, { ...msgs, ...messages }, attributes)
    } else {
      validator = Validator.make(data, rulesOrSchema, messages)
    }

    const passed = isAsync
      ? await validator.passesAsync()
      : validator.passes()

    if (!passed) {
      reply.code(422).send({
        message: 'The given data was invalid.',
        errors:  validator.errors,
      })
      return
    }

    req.validated = validator._extractValidated()
  }
}

/**
 * Register a Fastify plugin that adds a global validation error handler.
 *
 * Usage:
 *   await fastify.register(fastifyValidationPlugin)
 */
export async function fastifyValidationPlugin(fastify, options = {}) {
  fastify.setErrorHandler((err, req, reply) => {
    if (err.name === 'ValidationException') {
      return reply.code(422).send({
        message: 'The given data was invalid.',
        errors:  err.errors,
      })
    }
    reply.send(err)
  })
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isSchemaObject(obj) {
  return obj && typeof obj.toValidatorArgs === 'function'
}
