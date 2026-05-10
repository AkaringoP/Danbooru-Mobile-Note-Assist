/// <reference types="vitest" />
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    passWithNoTests: true,
    include: ['test/**/*.test.ts'],
    exclude: ['build/**', 'dist/**', 'node_modules/**'],
  },
});
