import { defineConfig } from 'vitest/config';

// Unit tests live next to source as src/**/*.test.ts.
// Playwright screenshot specs live in test/*.spec.ts and are NOT run by vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
