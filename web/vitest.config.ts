import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // ring-buffer.test.ts uses node:test (pure data-structure test, no DOM
     //  needed) — leave it to `pnpm --filter root test` and skip in vitest.
    exclude: ['__tests__/**', 'node_modules/**', 'lib/ring-buffer.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
