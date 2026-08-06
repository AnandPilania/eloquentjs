export default [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'module',
            globals: {
                // Node
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                queueMicrotask: 'readonly',
                globalThis: 'readonly',
                fetch: 'readonly',
                WebSocket: 'readonly',
                Intl: 'readonly',
                // Jest (tests only, but harmless to allow everywhere)
                describe: 'readonly',
                test: 'readonly',
                expect: 'readonly',
                beforeAll: 'readonly',
                beforeEach: 'readonly',
                afterAll: 'readonly',
                afterEach: 'readonly',
                jest: 'readonly',
            },
        },
        rules: {
            // Correctness
            'no-unused-vars': ['error', {
                args: 'none',              // resolver-contract arity matters; see conformance.js
                varsIgnorePattern: '^_',
                caughtErrors: 'none',
            }],
            'no-undef': 'error',
            'no-fallthrough': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-class-members': 'error',
            'no-duplicate-imports': 'error',
            'no-self-compare': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-async-promise-executor': 'error',
            'require-atomic-updates': 'off',   // too many false positives on await-in-loop
            'no-prototype-builtins': 'error',  // use Object.prototype.hasOwnProperty.call
            'no-shadow-restricted-names': 'error',
            'valid-typeof': 'error',
            'use-isnan': 'error',

            // Hygiene
            'eqeqeq': ['error', 'always', { null: 'ignore' }],
            'no-var': 'error',
            'prefer-const': ['error', { destructuring: 'all' }],
            'no-throw-literal': 'error',
            'no-return-await': 'error',
        },
    },
    {
        // Tests deliberately construct values they then don't read (to prove a call
        // doesn't throw) and compare loosely. The rules that matter in source are
        // noise here.
        files: ['tests/**/*.js'],
        rules: {
            'no-unused-vars': 'off',
            'eqeqeq': 'off',
        },
    },
    {
        // Generated declarations and coverage output are not source.
        ignores: [
            '**/node_modules/**',
            '**/dist-types/**',
            'coverage/**',
            'demo/**',
            'agent-files/**',
        ],
    },
]
