/**
 * Service worker for the installed app. Not bundled: the `serviceWorker()` plugin in
 * `vite.config.ts` copies this file into `dist/web/sw.js`, substituting the two placeholders below
 * with the built asset list and a hash of it — so a new build always means a new shell cache.
 *
 * Plain JS on purpose (it runs in worker scope, outside the app's module graph and typecheck).
 */

/* eslint-env serviceworker */

const VERSION = '__VERSION__';

/** App shell: index + hashed assets + icons. Wiped and refilled on every new build. */
const SHELL_CACHE = `todo-mcp-shell-${VERSION}`;

/** Last successful API responses, kept across versions so an offline launch still shows the wall. */
const DATA_CACHE = 'todo-mcp-data';

const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('todo-mcp-shell-') && key !== SHELL_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

// The page asks for this once the user accepts the update prompt.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Not ours to touch: other origins, and the MCP endpoint (agent traffic, never cacheable).
  if (url.origin !== self.location.origin || url.pathname === '/mcp') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/'));
    return;
  }

  // The background "anything new?" poll: a cached answer would be worse than no answer, and
  // serving one would flag the whole screen as stale. Straight to the network or nothing.
  if (url.pathname === '/api/todos/head') return;

  // Live probes into Azure DevOps (the settings panel's project/type/state lists). A cached
  // answer would describe somebody else's organization or a token that has since changed, and
  // serving one would flag the whole screen as stale over a lookup the todos do not depend on.
  if (url.pathname.startsWith('/api/devops/')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  event.respondWith(cacheFirst(request, SHELL_CACHE));
});

/**
 * Fresh data wins; the cache is only a safety net for a launch with the server down. `fallbackKey`
 * lets a navigation fall back to the precached shell even for a path we never cached by itself.
 */
async function networkFirst(request, cacheName, fallbackKey) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      void cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(cacheName);
    const cached = (await cache.match(request)) ?? (fallbackKey && (await cache.match(fallbackKey)));
    if (cached) return flagAsCached(cached);

    return new Response(JSON.stringify({ error: 'A szerver nem elérhető (offline).' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}

/**
 * Marks a response as "this is what we had, not what the server says now" — the app turns the header
 * into a visible badge, so stale todos are never mistaken for current ones.
 */
function flagAsCached(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Todo-Mcp-Cached', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Hashed assets never change under the same URL, so the cache is authoritative. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) void cache.put(request, response.clone());
  return response;
}
