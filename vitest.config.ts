import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
    // The recovery page inlines the tokens as text; vitest empties every other style.
    css: { include: /styles\/tokens\.css/ },
  },
});
