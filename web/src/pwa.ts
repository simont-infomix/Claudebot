/**
 * The installable-app plumbing: service worker registration, update handling, the install prompt
 * and online/offline state.
 *
 * The worker itself is only registered in a production build — under `dev:web` the Vite dev server
 * has no `/sw.js`, and a cached shell would fight HMR.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Chrome's install prompt event; still not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chrome fires `beforeinstallprompt` shortly after load, possibly before React has mounted, so the
// event is captured at module scope (this module is imported from main.tsx) and replayed to hooks.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

function setDeferredPrompt(event: BeforeInstallPromptEvent | null): void {
  deferredPrompt = event;
  for (const listener of promptListeners) listener();
}

window.addEventListener('beforeinstallprompt', (event) => {
  // Suppress Chrome's own mini-infobar; we offer a *Telepítés* button in the header instead.
  event.preventDefault();
  setDeferredPrompt(event as BeforeInstallPromptEvent);
});

window.addEventListener('appinstalled', () => setDeferredPrompt(null));

/** `null` while the browser does not consider the app installable (or it already is). */
export function useInstallPrompt(): (() => Promise<void>) | null {
  const [prompt, setPrompt] = useState(deferredPrompt);

  useEffect(() => {
    const listener = () => setPrompt(deferredPrompt);
    promptListeners.add(listener);
    return () => {
      promptListeners.delete(listener);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    // A dismissed prompt can be re-opened, an accepted one is spent.
    if (outcome === 'accepted') setDeferredPrompt(null);
  }, [prompt]);

  return prompt ? install : null;
}

/**
 * Registers the worker and reports when a newer build is waiting to take over. Returns `null` while
 * there is nothing to apply; otherwise a callback that activates the new worker and reloads.
 */
export function useAppUpdate(): (() => void) | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const applying = useRef(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

    // Only the update the user accepted should reload the page; the first registration taking
    // control of an uncontrolled page must not.
    const onControllerChange = () => {
      if (applying.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const cleanups = [
      () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange),
    ];

    void navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // A waiting worker only means "update" if this page is already controlled by an older one.
        const check = () => {
          if (registration.waiting && navigator.serviceWorker.controller) {
            setWaiting(registration.waiting);
          }
        };
        check();
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed') check();
          });
        });

        // An installed window can stay open across several rebuilds, and the browser only re-checks
        // the worker script on its own schedule — so ask again whenever the window regains focus.
        const recheck = () => {
          if (document.visibilityState === 'visible') void registration.update();
        };
        document.addEventListener('visibilitychange', recheck);
        cleanups.push(() => document.removeEventListener('visibilitychange', recheck));
      })
      .catch((error: unknown) => {
        console.warn('[pwa] service worker registration failed:', error);
      });

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return waiting
    ? () => {
        applying.current = true;
        waiting.postMessage('skip-waiting');
      }
    : null;
}

/**
 * Returns a callback that asks for notification permission, or `null` once the question is settled
 * (granted or denied) — so the header button disappears after the one time it is needed. Browsers
 * only honour the request from a user gesture, which is why this is a button and not a side effect.
 */
export function useNotificationPrompt(): (() => void) | null {
  const supported = 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  );

  const ask = useCallback(() => {
    void Notification.requestPermission().then(setPermission);
  }, []);

  return supported && permission === 'default' ? ask : null;
}

/**
 * A desktop notification for todos that landed while you were elsewhere — which is the normal case,
 * since the agent files them exactly when you are not watching. Skipped when the window is visible:
 * the chip in the header already says it, and a popup over the wall would be noise.
 */
export function notifyNewTodos(count: number): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;

  new Notification('Todo MCP', {
    body: count === 1 ? 'Új tétel érkezett a falra.' : `${count} új tétel érkezett a falra.`,
    // One rolling notification instead of a pile: the count is what matters, not each arrival.
    tag: 'todo-mcp-new',
  });
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}
