import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    clearMocks: true,
    // The config module validates as it loads, so anything it requires has to
    // be here: importing it is the first thing most of these tests do.
    env: {
      LOGS_EXPLORER_BASE_URL: 'https://logs.dev.cdp-int.defra.cloud'
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        ...configDefaults.exclude,
        '.public',
        'coverage',
        'postcss.config.js',
        'stylelint.config.js',
        'vitest.config.ts',
        '.sonarlint',
        'babel.config.cjs',
        'src/types/**',
        'src/**/__mocks__/**',
        'src/**/test-utils.ts',
        'src/**/test-fixtures.ts',
        'src/dev-ops/views/components/**'
      ]
    }
  }
})
