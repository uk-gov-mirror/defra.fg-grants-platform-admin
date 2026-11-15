import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { NodePackageImporter } from 'sass-embedded'

export default defineConfig({
  base: '/public',
  plugins: [tailwindcss()],
  build: {
    outDir: '.public',
    manifest: true,
    rolldownOptions: {
      input: {
        'html-assets': 'src/client/assets.html',
        application: 'src/client/javascripts/application.ts',
        'application-css': 'src/client/stylesheets/application.scss',
        'dev-ops-css': 'src/dev-ops/client/dev-ops.css',
        'dev-ops': 'src/dev-ops/views/legacy/index.ts',
        'design-system-css': 'src/dev-ops/views/components/index.css',
        'design-system': 'src/dev-ops/views/components/index.ts'
      }
    },
    sourcemap: true
  },
  css: {
    preprocessorOptions: {
      scss: {
        importers: [new NodePackageImporter()],
        loadPaths: [
          'node_modules',
          'src/client/stylesheets',
          'src/common/views',
          'src/common/views/components'
        ],
        quietDeps: true,
        sourceMapIncludeSources: true,
        style: 'expanded'
      }
    },
    lightningcss: { errorRecovery: true }
  },
  server: {}
})
