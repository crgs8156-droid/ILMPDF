// The fuzz round runs on its own, after the unit tests, so its worker
// threads don't slow the unit tests down (several of them have 5 s limits).
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tests/fuzz/**/*.test.ts'],
    environment: 'node',
  },
});
