# Terv: Electron-alapú vastag kliens a todo-mcp mellé

## Kontextus

A todo-mcp jelenleg egy Express szerver (`npm start`), amit kézzel kell elindítani, és egy rá
épülő telepíthető PWA. A felhasználó Windows-bejelentkezéskor automatikusan induló, natív
alkalmazásablakként megjelenő verziót szeretne, anélkül hogy kézzel kellene szervert futtatnia —
**de a tiszta szerver-módot sem szabad elveszíteni**, mert mások épp úgy használják a projektet
(`npm start`, fejnélküli, saját géptől független telepítés). A cél tehát egy **második,
opcionális build-kimenet** ugyanabból a kódbázisból: egy Electron-csomagolt, telepíthető Windows
alkalmazás, ami a szervert saját maga indítja/felügyeli, tálcaikonként fut a háttérben, és
Windows-bejelentkezéskor (opcionálisan) automatikusan elindul — mindezt **fork nélkül**, azaz nem
egy párhuzamos, elágazó implementációként, hanem a meglévő `src/`+`web/` build-artifaktumok
újrafelhasználásával.

Miért Electron és nem Tauri: a `src/db.ts` a beépített `node:sqlite`-ot használja, nincs natív
addon a repóban — ez pont azt a fájdalmat spórolja meg, ami miatt Tauri esetén Node-ot kellene
side­car-ként csomagolni (mivel Tauri nem hoz saját Node runtime-ot). Electron viszont saját maga
hoz egy Node-ot, így a végfelhasználó gépén nem kell külön Node telepítés, és a `node:sqlite`
réteg változtatás nélkül újrafelhasználható.

Az architektúra-döntés (folyamaton belüli hosztolás vs. külön `utilityProcess` gyerekfolyamat)
és az autostart alapértelmezés a felhasználóval egyeztetve lett: **folyamaton belüli hosztolás**,
és **autostart alapból KI, tálca-menüből bekapcsolható, rejtett indulással**.

## Javasolt architektúra

### 1. `src/server.ts` refaktor — kis, visszafelé kompatibilis seam

Ma a teljes fájl top-level side-effect kód: `openDb()`, `express()` felépítés, route-ok,
`app.listen(...)`, és a `SIGINT`/`SIGTERM` kezelő mind feltétel nélkül lefut importáláskor. Ezt
egy exportált `createApp(store)` + `startServer(options)` függvénypárra bontjuk, **logika
változtatása nélkül** — csak be kell csomagolni a jelenlegi kódot:

```ts
export function createApp(store: TodoStore): express.Express {
  // pontosan a mai app-építő kód (express(), guardHost, /mcp, /api/health,
  // createApiRouter(store), static, SPA catch-all) — csak most már return app;
}

export interface StartServerOptions {
  /** Alapból true (mai CLI-viselkedés). Electron false-t ad át — ő maga kezeli a saját
   *  app-életciklusát, nem szabad, hogy két globális signal-kezelő ütközzön. */
  registerSignalHandlers?: boolean;
}

export interface StartedServer {
  server: import('node:http').Server;
  db: import('node:sqlite').DatabaseSync;
  /** Idempotens: lezárja a HTTP szervert, majd a db-t. */
  stop: () => Promise<void>;
}

export function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const db = openDb();
  const store = new TodoStore(db);
  const app = createApp(store);
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      server.off('error', reject);
      console.log(/* ...mai log sorok... */);
      if (options.registerSignalHandlers ?? true) {
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
          process.on(signal, () => { void stop().finally(() => process.exit(0)); });
        }
      }
      resolve({ server, db, stop });
    });
    server.on('error', reject); // portütközés → reject, NEM uncaught crash
    const stop = () => new Promise<void>((res, rej) => {
      server.close((err) => { db.close(); err ? rej(err) : res(); });
    });
  });
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  void startServer().catch((err) => { console.error('[server] failed to start:', err); process.exit(1); });
}
```

Két apró, de fontos eltérés a mai kódtól:
- **`server.on('error', reject)`** — ma portütközéskor a Node-folyamat elszáll (uncaught error az
  `http.Server`-en). Ez CLI-ként elfogadható, de Electronban nem szabad, hogy egy foglalt port az
  egész alkalmazást lerántsa — ehelyett `startServer()` Promise-a elutasítódik, amit Electron
  tisztán el tud kapni (lásd 3. pont).
- **`registerSignalHandlers` opció** — `npm start`/`dev:server` byte-azonos módon viselkedik
  továbbra is (az opció alapértéke `true`), Electron `false`-t ad át.

Ez a refaktor **nem sérti** a CLAUDE.md-ben rögzített szabályokat ("egy Express-folyamat szolgál ki
mindent", "minden SQL a `TodoStore`-ban él") — csak egy indítási/leállítási seamet ad a már meglévő
kód köré. Jelenleg semmi más fájl nem importál a `server.ts`-ből, tehát a blast radius nulla a
`npm start`/`dev:server` szkripteken kívül, azok pedig kimenetileg és viselkedésileg változatlanok
maradnak.

### 2. Konfiguráció — nincs új felülírási mechanizmus

`src/config.ts` marad változatlan. Az Electron réteg **nem** állítja be a `TODO_MCP_PORT`/
`TODO_MCP_DB` env változókat — ugyanazt a `127.0.0.1:4321` portot és `~/.todo-mcp/todos.db`
adatbázist használja, mint a sima `npm start`. Ez szándékos: az adatok megosztottak maradnak
szerver-mód és vastag kliens mód között ugyanazon a gépen, nincs adat-elágazás. (Ha valaki mégis
más portot/DB-t akarna, a meglévő env-változós útvonal továbbra is működik, ahogy ma is.)

### 3. Együttélés egy már futó szerver-mód példánnyal

Electron indításkor előbb próbát tesz:

```ts
async function probeExistingServer(): Promise<boolean> {
  try {
    const res = await fetch(`http://${HOST}:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch { return false; }
}
```

- Ha válaszol → **nem** indít saját szervert (`ownsServer = false`), csak megnyitja az ablakot a
  meglévő szerver URL-jére. Kilépéskor nem nyúl hozzá — nem az övé.
- Ha nem válaszol → `const { startServer } = await import('../server.js'); const handle = await
  startServer({ registerSignalHandlers: false });` — `ownsServer = true`, a `handle.stop()`
  felelőssége az övé lesz.
- Race-eset (valaki más köti le a portot a probe és a `listen` között) → a fenti `server.on('error',
  reject)` miatt tisztán elkapható, ilyenkor újra-probe és attach-mód, nem crash.

**Fontos ESM-sorrendezési csapda, amit el kell kerülni:** a `startServer` importját **dinamikusan**
(`await import(...)`) kell végezni, egy async `boot()` függvényen belül, **azután**, hogy eldőlt,
hogy tényleg szükség van rá — statikus top-level importtal a modul-gráf (és benne `db.ts`/
`openDb()`) már azelőtt lefutna, hogy eldőlne, kell-e egyáltalán.

### 4. Egyetlen Electron-példány lock

```ts
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { win?.show(); win?.focus(); });
  app.whenReady().then(boot);
}
```

Ez külön réteg a 3. ponttól: itt azt akadályozzuk meg, hogy két Electron-*folyamat* egyszerre
versenyezzen a porton — újraindításkor (Start menü, autostart, dupla-katt) csak fókuszba hozza a
meglévő ablakot.

### 5. Leállítás

```ts
app.on('before-quit', (e) => {
  if (!ownsServer || !serverHandle || stopped) return;
  e.preventDefault();
  stopped = true;
  void serverHandle.stop().finally(() => app.quit());
});
```

Mivel folyamaton belüli hosztolásról van szó, ez egy egyszerű, megbízható függvényhívás — nincs
OS-szintű signal-megbízhatósági kérdés (ami Windows-on a gyerekfolyamatos megoldásnál probléma
lenne). Ha `ownsServer === false` (mert csatlakozott egy már futó szerverhez), kilépéskor **semmit**
nem zár le — más folyamatot nem szabad megzavarni.

### 6. Tálcaikon, ablak-bezárás = rejtés, valódi kilépés

```ts
win.on('close', (e) => {
  if (!isQuitting) { e.preventDefault(); win?.hide(); }
});
```

Tálca-menü: "Megnyitás", elválasztó, "Indítás Windows-szal" (checkbox, `app.getLoginItemSettings()
.openAtLogin` állapotát tükrözi), elválasztó, "Kilépés" (ez állítja `isQuitting = true`-ra, majd
`app.quit()`).

### 7. Autostart — alapból KI, tálcáról bekapcsolható, rejtett indulással

```ts
{
  label: 'Indítás Windows-szal', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
  click: (item) => app.setLoginItemSettings({
    openAtLogin: item.checked, path: process.execPath, args: ['--hidden'],
  }),
}
```

A `--hidden` argumentumot a `createWindow()` induláskor nézi (`process.argv.includes('--hidden')`):
ha jelen van, az ablak nem jelenik meg, csak a tálcaikon — pontosan azt a viselkedést adja, amit a
felhasználó választott (alapból kikapcsolt autostart, bekapcsolva pedig néma, tálcára induló
háttérfolyamat).

### 8. Csomagolás

Új devDependency: `electron`, `electron-builder`. Új fájlok:

- **`tsconfig.electron.json`** — a `tsconfig.server.json` mintájára: `module`/`moduleResolution:
  "NodeNext"` (ESM), `rootDir: "electron"`, `outDir: "dist/electron"`. Az ESM megtartása azért
  fontos, mert egy CommonJS Electron-tsconfig a `await import(...)`-ot `require()`-re fordítaná
  vissza, ami elhasalna egy tisztán ESM `dist/server.js`-en.
- **`electron/main.ts`** — a fenti 3–7. pontok teljes folyama egy fájlban (elég kicsi hogy egyben
  maradjon; ha nő, `tray.ts`/`window.ts` szétválasztás egy jövőbeli, kis lépés lehet).
- **`electron-builder.yml`** — **kritikus csapda**: az electron-builder alapértelmezett kimeneti
  mappája szó szerint `dist`, ami ütközne a projekt meglévő `dist/`-jével (tsc+vite kimenet). Ezt
  explicit felül kell írni:
  ```yaml
  appId: hu.hphdigital.todomcp
  productName: Todo MCP
  directories: { output: release }
  files: [dist/**/*, "!dist/**/*.map", package.json]
  win: { target: nsis, icon: build/icon.ico }
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true }
  ```
- **`package.json`** — csak additív módosítás:
  - `"main": "dist/electron/main.js"` (ezt csak Electron/electron-builder olvassa, az `npm start`
    közvetlenül a `dist/server.js` útvonalat hívja, nem érinti)
  - új szkriptek, a meglévők bántása nélkül:
    ```json
    "dev:desktop": "npm run build && tsc -p tsconfig.electron.json && electron .",
    "build:desktop": "npm run build && tsc -p tsconfig.electron.json && electron-builder --win"
    ```
- **Ikon**: a `tools/make-icons.mjs` kézzel írt PNG-encodere ma is meglévő mintát ad — ezt érdemes
  kiegészíteni (nem lecserélni) egy Windows `.ico` konténer generálásával (`ICONDIR`/
  `ICONDIRENTRY` header a már létező PNG-bájtok köré csomagolva — Vista óta ezt natívan támogatja
  Windows, nem kell új pixel-kódolás), hogy a projekt "nincs image-dependency" filozófiája
  megmaradjon a telepítő ikonjára is. A futásidejű ablak/tálca ikon egyszerűen újrahasznosítja a
  meglévő `web/public/icon-192.png`-t.
- **`.gitignore`**: `release/` hozzáadása (a `dist` már benne van, ami a `dist/electron`-t is fedi).

`node:sqlite` natív-modul kockázat nincs (nincs `.node` addon a `src/`-ben), tehát **nincs**
`electron-rebuild`/ABI-rebuild lépés — ez a leggyakoribb Electron+SQLite csomagolási fájdalom itt
eleve nem létezik.

### 9. Kockázat-ellenőrzés: Electron beágyazott Node-verziója

A `node:sqlite` stabil (flag nélküli) támogatása Node ~22.13/24 óta van meg. Mivel folyamaton
belüli hosztolásról van szó, nincs alternatív Node-futtatókörnyezet — az Electron csomagba épített
Node verziója számít. **Ezt implementáció előtt, a legelső lépésként ellenőrizni kell**:
```
npx electron -e "console.log(process.versions.node)"
```
és a `boot()`-ban is logolni (`console.log('[electron] node:', process.versions.node)`), hogy
csomagolt appban is látszódjon. Ha a kiválasztott Electron-verzió beépített Node-ja túl régi, az
egyetlen javítás egy újabb `electron` devDependency-verzióra pinnelés — nincs kód-szintű
workaround, ezért ez legyen az implementáció nulladik lépése, mielőtt bármi más Electron-kód
készül.

### 10. Service worker az Electron ablakban

A `web/src/pwa.ts`-ben a service worker regisztrációját (és a `Telepítés`/`beforeinstallprompt`
logikát) **le kell tiltani** Electron-kontextusban, futásidejű UA-detektálással:
```ts
const isElectron = () => navigator.userAgent.includes('Electron/');
```
A `useAppUpdate()` meglévő `if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;`
sora bővül `|| isElectron()`-nel. Indoklás: a service worker értéke ("a szerver nem indul
automatikusan, ezért egy cache-ből nyíló, azt jelző app jobb, mint egy böngésző-hibaoldal") itt már
jobb rétegben van megoldva — Electron *már eldöntötte és megnyitotta a szervert*, mielőtt az ablak
egyáltalán megjelenne, így a SW saját cache/frissítés-logikája csak egy második, redundáns
"melyik verziót látom" rendszert adna a csomagolt app saját frissítési mechanizmusa mellé. Ez
egyetlen fájlt (`web/src/pwa.ts`) érint, a `dist/web` build ugyanaz marad böngésző-PWA és Electron
számára is — csak a UA-ág dönt futásidőben.

## Kritikus fájlok

| Fájl | Művelet | Felelősség |
|---|---|---|
| `src/server.ts` | módosít | `createApp()`/`startServer()` export, `isMainModule` guard |
| `src/config.ts` | nem módosul | (csak import, viselkedés változatlan) |
| `web/src/pwa.ts` | módosít | SW-regisztráció letiltása Electron UA esetén |
| `electron/main.ts` | új | single-instance lock, probe/host, ablak, tálca, autostart, leállítás |
| `tsconfig.electron.json` | új | ESM build config az `electron/`-hoz |
| `electron-builder.yml` | új | Windows NSIS csomagolás, `output: release` |
| `tools/make-icons.mjs` | bővít | `.ico` generálás a meglévő rasterizer újrahasznosításával |
| `package.json` | additív módosítás | `main`, `dev:desktop`/`build:desktop` szkriptek, új devDependency-k |
| `.gitignore` | módosít | `release/` |

Újrafelhasznált meglévő elemek: `src/server.ts`-ben már létező `/api/health` (readiness-probe-hoz,
nem kell új endpoint), `TodoStore`/`openDb` (`src/repo.ts`, `src/db.ts` — érintetlen), a meglévő
`GlobalStyles`/tema-logika és `web/public/icon-192.png` (tálca-/ablak-ikonhoz).

## Verifikáció

1. `npm run build` továbbra is hibátlanul lefut, és `npm start` pontosan úgy viselkedik, mint ma
   (manuális teszt: indítás, `/api/health` lekérdezés, Ctrl+C → tiszta leállás logolva).
2. Node-verzió ellenőrzés (`npx electron -e "console.log(process.versions.node)"`) — dokumentálva
   a talált verziót, mielőtt bármi más készül.
3. `npm run dev:desktop`: Electron ablak megnyílik, a UI ugyanaz mint böngészőben, `/api/todos`
   működik, tálcaikon megjelenik, ablak bezárása tálcára rejt (nem zár ki), "Kilépés" tisztán
   leállítja (log: `stop()` lefut, `db.close()` megtörténik, folyamat kilép).
4. Együttélés-teszt: kézzel `npm start`, majd `npm run dev:desktop` — az Electron nem próbál új
   szervert indítani (log mutatja az attach-ágat), és kilépéskor nem állítja le a kézzel indított
   szervert.
5. Autostart: tálca-menüből bekapcsolás után `HKCU\...\Run` bejegyzés ellenőrzése (vagy Feladatkezelő
   → Indítás fül), kijelentkezés/bejelentkezés szimulációja nélkül is elfogadható a
   `app.getLoginItemSettings().openAtLogin` visszaolvasása igaz értékkel.
6. `npm run build:desktop`: NSIS telepítő létrejön a `release/` mappában, a `dist/` build nem
   sérül/keveredik össze vele; telepítés után az app önállóan (rendszer Node nélkül) elindul.
