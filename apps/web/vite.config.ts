import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@tradepilot/config': path.resolve(__dirname, '../../packages/config/src/index.ts'),
      '@tradepilot/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@tradepilot/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
});
