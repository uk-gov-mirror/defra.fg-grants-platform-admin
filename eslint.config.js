import neostandard from 'neostandard'
import importX from 'eslint-plugin-import-x'
import vitest from '@vitest/eslint-plugin'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [
      ...neostandard.resolveIgnoresFromGitignore(),
      // Copied as it is: re-run the copy (README) to change it.
      'src/dev-ops/views/components/**'
    ],
    noJsx: true,
    noStyle: true,
    ts: true
  }),
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    plugins: {
      'import-x': importX
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()]
    },
    rules: {
      'func-style': ['error', 'expression'],
      complexity: ['error', { max: 4 }],
      'no-console': 'error',
      'import-x/no-default-export': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-cycle': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: '**/repositories/**/!(*.test).ts',
              from: ['**/routes/**', '**/use-cases/**'],
              message: 'Repositories should not import routes or use cases'
            },
            {
              target: '**/routes/**/!(*.test).ts',
              from: ['src/**'],
              except: [
                '**/use-cases/**',
                '**/view-models/**',
                '**/common/config.ts',
                '**/common/logger.ts',
                '**/common/roles.ts'
              ],
              message:
                'Routes should only import use cases, view models, and common helpers'
            },
            {
              target: '**/use-cases/**/!(*.test).ts',
              from: ['src/**'],
              except: ['**/common/**', '**/repositories/**', '**/use-cases/**'],
              message:
                'Use cases should only import common, repositories and other use cases'
            }
          ]
        }
      ]
    }
  },
  {
    ...vitest.configs.recommended,
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      ...vitest.configs.recommended.rules,

      // Recommended ships this one as a warning and `lint:js` runs without
      // --max-warnings, so it would never fail a build.
      'vitest/no-disabled-tests': 'error',

      // One flat describe per unit under test: nesting hides the setup a test
      // depends on, and a condition reads just as well in the test title.
      'vitest/consistent-test-it': ['error', { fn: 'test' }],
      'vitest/max-nested-describe': ['error', { max: 1 }],

      // Globals come from `globals: true` in vitest.config.ts.
      'vitest/no-importing-vitest-globals': 'error',

      // Hoisting and hook ordering are a real source of surprise: vi.mock is
      // lifted above imports, and hooks declared below tests still run first.
      'vitest/hoisted-apis-on-top': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/prefer-hooks-in-order': 'error',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/require-hook': 'error',

      // Tests should be straight-line.
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-test-return-statement': 'error',
      'vitest/require-to-throw-message': 'error',

      // We mock by module reference (`vi.mock(import('pino'))`) so the path
      // stays type-checked and refactorable.
      'vitest/prefer-import-in-mock': 'error',
      'vitest/prefer-vi-mocked': 'error',
      'vitest/prefer-spy-on': 'error',
      'vitest/prefer-mock-promise-shorthand': 'error',

      // Matcher hygiene. Each of these has an opposite-direction counterpart in
      // the plugin, so the direction is picked here rather than taken from the
      // `all` preset and subtracted from.
      'vitest/no-alias-methods': 'error',
      'vitest/prefer-strict-boolean-matchers': 'error',
      'vitest/prefer-called-times': 'error',
      'vitest/prefer-comparison-matcher': 'error',
      'vitest/prefer-equality-matcher': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-to-have-length': 'error'
    }
  },
  {
    // Ambient module declarations mirror the real (default) exports of the
    // untyped third-party packages they describe, so this isn't a style choice.
    files: ['src/common/types/**/*.d.ts'],
    rules: {
      'import-x/no-default-export': 'off'
    }
  }
]
