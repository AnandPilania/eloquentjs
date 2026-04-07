/**
 * @eloquentjs/codegen — Public API
 *
 * Shared code generation engine used by:
 *   @eloquentjs/graphql  — runtime schema generation
 *   @eloquentjs/cli      — file generation commands
 *
 * Consumers:
 *   import { introspect, generateGraphqlSchema } from '@eloquentjs/codegen'
 *   import { introspect } from '@eloquentjs/codegen/introspect'
 *   import { generateGraphqlSDL } from '@eloquentjs/codegen/templates'
 *   import { renderGraphql } from '@eloquentjs/codegen/render'
 */

// Introspection
export { introspect, introspectAll, resolveCastType, CAST_TYPE_MAP } from './introspect.js'

// Templates
export {
  generateGraphqlSDL,
  generateGraphqlSchema,
  generateTypeScriptTypes,
  generateTypeScriptFile,
  generateOpenApiSpec,
  generateModelStub,
  generateMigrationStub,
  generateFactoryStub,
  generateSeederStub,
} from './templates/index.js'

// Render engine
export {
  loadModelsFromDir,
  loadModelsByName,
  renderGraphql,
  renderTypeScript,
  renderOpenApi,
  renderStubs,
} from './render.js'
