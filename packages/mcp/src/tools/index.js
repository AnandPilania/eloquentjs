export { introspectTools, handleListModels, handleDescribeModel,
         handleListMigrations, handleDescribeDatabaseSchema, handleGetProjectStructure }
  from './introspect.js'

export { generateTools, handleGenerateModel, handleGenerateMigration,
         handleGenerateGraphqlSchema, handleGenerateTypeScriptTypes, handleGenerateOpenApiSpec }
  from './generate.js'

export { queryTools, handleQueryModel, handleRunRawQuery, handleRunMigrations,
         handleRollbackMigration, handleMigrationStatus, handleRunSeeder }
  from './query.js'

export { helpTools, handleGetHelp, handleGetMethodSignature, handleGetExamples,
         handleNlpQuery, handleNlpCrud }
  from './help.js'

// All tool definitions combined
import { introspectTools } from './introspect.js'
import { generateTools }   from './generate.js'
import { queryTools }      from './query.js'
import { helpTools }       from './help.js'

export const ALL_TOOLS = [
  ...introspectTools,
  ...generateTools,
  ...queryTools,
  ...helpTools,
]
