import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js', 'test/**/*.integration.test.js'],
    testTimeout: 15000,
    hookTimeout: 10000,
    fileParallelism: false,
  },
});
