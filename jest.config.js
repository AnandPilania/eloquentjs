export default {
  testEnvironment: 'node',
  transform: {},
  moduleNameMapper: {
    '^@eloquentjs/core$':     '<rootDir>/packages/core/src/index.js',
    '^@eloquentjs/pgsql$':    '<rootDir>/packages/pgsql/src/index.js',
    '^@eloquentjs/mongodb$':  '<rootDir>/packages/mongodb/src/index.js',
    '^@eloquentjs/realtime$': '<rootDir>/packages/realtime/src/index.js',
    '^@eloquentjs/graphql$':  '<rootDir>/packages/graphql/src/index.js',
    '^@eloquentjs/api$':      '<rootDir>/packages/api/src/index.js',
  },
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['packages/*/src/**/*.js'],
}
