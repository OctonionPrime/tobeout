import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    // Look for test files in these locations
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Exclude client directory from test scanning
    exclude: ['node_modules/**', 'dist/**', 'client/**'],
    // Set test environment
    environment: 'node',
    // Mock setup
    globals: true,
    // Root directory - make it explicit
    root: path.resolve('.'),
    // INCREASE TIMEOUT for API calls
    testTimeout: 15000, // 15 seconds instead of 5
  },
  resolve: {
    // Add resolver for TypeScript path aliases
    alias: {
      '@': path.resolve('.'),
      '@server': path.resolve('./server'),
      '@shared': path.resolve('./shared'),
      // Add specific resolvers for common imports
      '@shared/schema': path.resolve('./shared/schema.ts'),
      '@shared/types': path.resolve('./shared/types.ts'),
    }
  }
})