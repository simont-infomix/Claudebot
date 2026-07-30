# Todo MCP

MCP szerver + webes miniapp azoknak a kérdéseknek, amik coding agenttel (Claude Code) végzett munka
közben merülnek fel, de **emberi döntést igényelnek**. Az agent az `add_todo` toollal félreteszi őket,
és folytatja a munkát; te a böngészőben nézed át, váltasz státuszt és bejegyzésekkel követed a haladást.

Ez nem az agent teendőlistája: **nincs visszacsatolás** az agent felé. Ha egy döntést meg kell
valósítani, azt te adod be neki a szokásos módon.

## Felépítés

Egy Node process szolgál ki mindent a `127.0.0.1:4321`-en:

| Útvonal | Mi |
|---|---|
| `/mcp` | streamable HTTP MCP végpont (stateless) |
| `/api/*` | JSON API a web UI-nak |
| `/` | a beépített React SPA |

Az adatok egyetlen globális SQLite fájlban vannak (`~/.todo-mcp/todos.db`), tehát minden projekt
todója egy helyen látszik; a `repo` mező a szűrő.

## Telepítés

```bash
npm install
npm run build
npm start          # → todo-mcp listening on http://127.0.0.1:4321
```

MCP szerver regisztrálása Claude Code-ban (elég egyszer, minden projektre érvényes):

```bash
claude mcp add --transport http todo-mcp http://127.0.0.1:4321/mcp --scope user
```

Ezután új session-ben a `/mcp` listázza a `todo-mcp`-t, és az agent használhatja az `add_todo`-t.

**A szolgáltatás nem indul automatikusan.** Ha nem fut, az MCP hívás hibát ad (az agent jelzi).
Ha automatikus indítást akarsz, tegyél egy `.cmd`-t a `shell:startup` mappába, ami `npm start`-ot
futtat ebben a könyvtárban.

## Konfiguráció

| Env var | Default | Mi |
|---|---|---|
| `TODO_MCP_PORT` | `4321` | HTTP port |
| `TODO_MCP_DB` | `~/.todo-mcp/todos.db` | SQLite fájl útvonala |

A szerver mindig csak `127.0.0.1`-re bindol, és nincs autentikáció: egygépes, egyfelhasználós eszköz.
A `/mcp` végpont a `Host` fejlécet ellenőrzi (DNS rebinding ellen).

## MCP toolok

**`add_todo(repo, title, description?)`** — felvesz egy tételt `open` státusszal.
`repo` a projektmappa rövid neve (pl. `todo-mcp`), `title` egy soros (kérdés, ha döntés kell),
`description` opcionális kontextus, markdownként renderelve.

**`list_todos(repo?, status?)`** — a már felvett tételek (default: `open` + `in_progress`).
Célja, hogy az agent lássa, mi van bent, és ne írja be kétszer ugyanazt. Bejegyzéseket nem ad vissza.

## Web UI

`http://127.0.0.1:4321`

- flat lista, `repo` és státusz szűrővel; default az aktívak (nyitott + folyamatban), legfrissebb elöl
- egy sort lenyitva: leírás (markdown), státuszváltás `nyitott → folyamatban → lezárt`,
  bejegyzés-szál, cím/leírás szerkesztés, törlés
- kézzel is felvehetsz todót (a `repo` mező felajánlja a már létező neveket)
- **nincs automatikus frissítés**: a közben MCP-n bejött todókhoz nyomd meg a *Frissítés* gombot

## Telepítés alkalmazásként

A UI telepíthető webalkalmazás (PWA), így külön ablakban, saját ikonnal indul, böngészősáv nélkül.

- **Telepítés**: nyisd meg a `http://127.0.0.1:4321`-et, és nyomd meg a fejlécben a *Telepítés*
  gombot (vagy Chrome/Edge: címsor jobb szélén a telepítés ikon → *Telepítés*). A loopback origó
  biztonságos kontextusnak számít, ezért nem kell HTTPS.
- **Eltávolítás**: az alkalmazás ablakában `⋮` → *Eltávolítás*, vagy Windows *Alkalmazások* lista.
- **Ha nem fut a szerver**: az app így is elindul a mentett állapotból, és a fejlécben jelzi, hogy
  *Mentett adatok – a szerver nem fut*. Szerkeszteni ilyenkor nem lehet (a mentés hibát ad),
  a mentett todók csak olvashatók. Indítsd el az `npm start`-ot, majd *Frissítés*.
- **Új verzió**: build után az app alján felajánlja az *Újratöltés*t; sosem tölt újra magától.

Semmi nem töltődik le a hálózatról: az ikonok, a betűkészlet-stack és a textúrák mind helyben
készülnek, így az app offline is ugyanúgy néz ki.

## Fejlesztés

```bash
npm start        # szerver (API + MCP), a buildelt UI-t is kiszolgálja
npm run dev:web  # Vite dev szerver HMR-rel, /api proxyval a fenti szerverre
npm run build    # tsc (szerver) + tsc --noEmit (web) + vite build
npm run icons    # PWA ikonok újragenerálása (web/public/*.png)
```

A service worker csak a buildelt appban regisztrálódik, `dev:web` alatt nem — így a HMR-t nem
zavarja cache.

Nincs automata teszt; a típusellenőrzés a `npm run build`-ban fut.

Forrásfák: `src/` a szerver (`repo.ts`-ben minden SQL, ezen keresztül megy az MCP és az API is),
`web/` a React SPA.
