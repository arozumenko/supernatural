import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@supernatural/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [
        path.resolve(__dirname, '..'),  // allow monorepo root (for shared/)
      ],
    },
  },
});
