import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Hand-mirrored from src/config.ts — the same convention CLAUDE.md documents for web/src/types.ts
 * mirroring src/repo.ts. Deliberately not imported: this project (tsconfig.electron.json) has its
 * own rootDir/outDir, and a static cross-project TS import would either fail to resolve or pull
 * the whole server + its dependency graph into this compilation. Keep in sync with config.ts.
 */
const HOST = '127.0.0.1';
const PORT = Number(process.env.TODO_MCP_PORT ?? 4321);

const APP_URL = `http://${HOST}:${PORT}`;
const HEALTH_URL = `${APP_URL}/api/health`;
/**
 * `dist/web/icon-192.png`, not the `web/public/` source: electron-builder's `files` list only
 * packages `dist/**` (see electron-builder.yml), so the source copy doesn't exist in a built app —
 * only vite's copy of it, sitting next to this file's own `dist/electron` at build time.
 */
const ICON_PATH = join(import.meta.dirname, '..', 'web', 'icon-192.png');

/**
 * dist/server.js is a sibling build (tsconfig.server.json), loaded at runtime relative to this
 * file's own compiled location — not via a static TS import, and deliberately not a string
 * literal passed to `import()` (TypeScript would try to statically resolve a literal specifier,
 * hitting the same cross-project problem `HOST`/`PORT` above avoid).
 */
const SERVER_ENTRY_URL = pathToFileURL(join(import.meta.dirname, '..', 'server.js')).href;

interface StartedServer {
  stop: () => Promise<void>;
}

interface ServerModule {
  startServer(options?: { registerSignalHandlers?: boolean }): Promise<StartedServer>;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverHandle: StartedServer | null = null;
let isQuitting = false;

async function probeExistingServer(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Probes before hosting: if another instance (a plain `npm start`, or a previous Electron
 * instance) already answers on this port, we attach to it instead of forking a duplicate — and,
 * crucially, we then never touch its lifecycle on quit.
 */
async function ensureServerRunning(): Promise<void> {
  if (await probeExistingServer()) {
    console.log('[electron] existing server detected — attaching, not hosting');
    return;
  }

  const { startServer } = (await import(SERVER_ENTRY_URL)) as ServerModule;
  try {
    serverHandle = await startServer({ registerSignalHandlers: false });
    console.log('[electron] hosting server in-process');
  } catch (error) {
    // Someone else won the race for the port between our probe and our listen attempt.
    if (await probeExistingServer()) {
      console.log('[electron] lost the startup race — attaching to the server that won it');
      return;
    }
    throw error;
  }
}

function createWindow(showOnCreate: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: showOnCreate,
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });

  void win.loadURL(APP_URL);
  return win;
}

function buildTrayMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Megnyitás',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Indítás Windows-szal',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          path: process.execPath,
          args: ['--hidden'],
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Kilépés',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
  return Menu.buildFromTemplate(template);
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  const trayIcon = new Tray(icon);
  trayIcon.setToolTip('Todo MCP');
  trayIcon.setContextMenu(buildTrayMenu());
  trayIcon.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  return trayIcon;
}

async function boot(): Promise<void> {
  console.log('[electron] node:', process.versions.node);

  try {
    await ensureServerRunning();
  } catch (error) {
    console.error('[electron] failed to start or reach the server:', error);
    dialog.showErrorBox(
      'Todo MCP',
      'Nem sikerült elindítani vagy elérni a szervert. Fusson le előbb az "npm run build".',
    );
    app.exit(1);
    return;
  }

  const startHidden = process.argv.includes('--hidden');
  mainWindow = createWindow(!startHidden);
  tray = createTray();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // Closing the window hides it to the tray; it does not quit the app (see the `close` handler
  // in createWindow), so there is nothing extra to do here — just don't let Electron's default
  // "quit when the last window closes" behavior kick in.
  app.on('window-all-closed', () => {});

  app.on('before-quit', (event) => {
    isQuitting = true;
    if (!serverHandle) return;
    const handle = serverHandle;
    serverHandle = null;
    event.preventDefault();
    void handle.stop().finally(() => app.quit());
  });

  void app.whenReady().then(boot);
}
