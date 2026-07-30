import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = `http://127.0.0.1:${process.env.TODO_MCP_PORT ?? 4321}`;

/** Files from `web/public/` that the installed app must have available offline. */
const PUBLIC_ASSETS = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
];

/**
 * Emits `dist/web/sw.js` from `web/sw.js`, baking in the precache list (the hashed asset names are
 * only known here) and a version hashed from everything precached — so any change to the app or its
 * icons invalidates the shell cache, while an unchanged rebuild keeps it.
 */
function serviceWorker(): Plugin {
  return {
    name: 'todo-mcp-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => file !== 'index.html')
        .sort()
        .map((file) => `/${file}`);
      const precache = ['/', ...built, ...PUBLIC_ASSETS];

      const hash = createHash('sha256');
      hash.update(precache.join('\n'));
      const index = bundle['index.html'];
      if (index?.type === 'asset') hash.update(index.source);
      for (const asset of PUBLIC_ASSETS) {
        hash.update(readFileSync(new URL(`./web/public${asset}`, import.meta.url)));
      }

      const template = readFileSync(new URL('./web/sw.js', import.meta.url), 'utf8');
      const source = template
        .replaceAll('__PRECACHE__', JSON.stringify(precache, null, 2))
        .replaceAll('__VERSION__', hash.digest('hex').slice(0, 12));
      if (source === template) {
        this.error('web/sw.js has no __PRECACHE__ / __VERSION__ placeholder left to substitute');
      }

      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [react(), serviceWorker()],
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
