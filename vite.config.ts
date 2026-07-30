import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = `http://127.0.0.1:${process.env.TODO_MCP_PORT ?? 4321}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // A localhost-only tool: one big chunk is fine, no need for the default 500 kB warning.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    proxy: {
      '/api': API_TARGET,
    },
  },
});
