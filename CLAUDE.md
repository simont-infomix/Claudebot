# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server plus a small React web app for parking questions that come up while a coding agent
works but need a **human decision**. The agent files items with `add_todo` and moves on; the human
triages them in the browser. There is deliberately **no feedback path back to the agent** — the tool
returns only a confirmation, and `list_todos` never exposes the human's comments or decisions.

`specification.md` is the original (Hungarian) sketch; `README.md` is the user-facing doc, also in
Hungarian. The UI strings are Hungarian; all code, comments and identifiers are English.

## Commands

```bash
npm install
npm run build      # tsc (server → dist/) + tsc --noEmit (web typecheck) + vite build (→ dist/web/)
npm start          # serves API + MCP + built SPA on http://127.0.0.1:4321
npm run dev:server # same, with node --watch over dist/ (needs a build first)
npm run dev:web    # Vite dev server with HMR, proxies /api to the running server
```

There is no test suite and no linter. `npm run build` is the only check — it typechecks both source
trees, so always run it before finishing. `npm start` serves the *built* SPA from `dist/web`, so any
web change needs a rebuild (or use `dev:web` alongside a running server).

Requires Node 22+: the DB layer uses the built-in `node:sqlite` (`DatabaseSync`), which is why the
start scripts pass `--disable-warning=ExperimentalWarning`. No native SQLite dependency.

## Architecture

One Express process (`src/server.ts`) serves three things on loopback only:

| Path | What |
|---|---|
| `/mcp` | streamable HTTP MCP endpoint, **stateless** — a fresh `McpServer` + transport per POST |
| `/api/*` | JSON API for the web UI (`src/api.ts`) |
| `/` | the built SPA, with a catch-all GET fallback to `index.html` |

The key structural rule: **all SQL lives in `TodoStore` (`src/repo.ts`)**, and both the MCP tools
(`src/mcp.ts`) and the JSON API (`src/api.ts`) go through it. Neither writes SQL directly. `repo.ts`
also owns the `Status` union and `ACTIVE_STATUSES`.

Data model (`src/db.ts`, schema applied idempotently on every open): `todos` (repo, title,
description, status ∈ `open|in_progress|closed`, timestamps as epoch ms) and `comments` with
`ON DELETE CASCADE`. Writing or editing a comment also bumps the parent todo's `updated_at`, since
lists are ordered `updated_at DESC` — activity floats an item to the top.

Storage is a **single global SQLite file** at `~/.todo-mcp/todos.db` (override with `TODO_MCP_DB`),
shared across all projects; the `repo` column is the only separation. `repo` is expected to be the
basename of the project folder, and consistency depends on the agent spelling it the same each time —
hence the emphasis in the `add_todo` tool description.

`src/config.ts` centralises host/port/paths. Port is `TODO_MCP_PORT` (default 4321), and
`ALLOWED_HOSTS` is derived from it — `/mcp` rejects any other `Host` header (DNS-rebinding guard,
replacing the SDK's deprecated option). No auth: single-user, single-machine, loopback only.

### Web SPA (`web/`)

React 19 + MUI 9 + Emotion, Vite with `root: 'web'`, built into `dist/web`. `web/src/types.ts`
**hand-mirrors** the server types from `src/repo.ts` — there is no shared package or codegen, so a
change to `Todo`/`Comment`/`Status` must be made in both files. `web/src/api.ts` is the only place
that talks to `/api`.

`App.tsx` offers **two equal views** over the same data, switched by the *Fal / Lista* toggle in the
header and remembered in `localStorage` under `todo-mcp:view` (default: `board`):

- **`board`** — a cork wall of post-it notes: a CSS grid of `TodoNote` cards; clicking one opens
  `TodoDetailDialog` (description, status, edit, delete, `CommentThread`).
- **`list`** — the original flat accordion list of `TodoRow`s, which expand in place.

Both get the same repo + status filters (defaulting to active items) and the same handlers; `board`
additionally styles the header, filter strip, empty state and new-todo form as paper, and paints the
cork on `body` via `GlobalStyles` — which is why those bits are conditional on `view` rather than
unconditional. `NewTodoForm`/`CommentThread` take an optional `sheet`/`onSheet` flag for that; without
it they render exactly as they did before the board existed.

The UI **never polls or auto-refreshes**: todos arriving over MCP appear only after the user hits
*Frissítés*. When an inline edit makes an item stop matching the current filter, it is kept in place
until the next refresh rather than disappearing mid-interaction.

`web/src/board.ts` owns the board's look: note paper colour per status (yellow/blue/green — the wall is
meant to be glanceable), ink colour, the deterministic per-id tilt and pin colour, and the cork and
paper textures. The textures are inline `feTurbulence` SVG data URIs and the handwriting font is a
system-font stack — nothing is downloaded, since this is a loopback tool that must work offline.
Light/dark variants go through `theme.applyStyles('dark', …)`; notes stay light paper with dark ink in
both schemes.

## Conventions

- ESM throughout (`"type": "module"`); server imports use explicit `.js` extensions (NodeNext).
- `strict` + `noUncheckedIndexedAccess` are on in the base tsconfig.
- `node:sqlite` returns `INTEGER` columns as `bigint`; `repo.ts` funnels them through `num()` — keep
  new columns going through the `toTodo`/`toComment` mappers rather than casting rows inline.
- MCP tool descriptions are long, deliberate prose (`ADD_TODO_DESCRIPTION` in `src/mcp.ts`): they are
  what stops an agent from treating this as its own scratch todo list or expecting an answer back.
  Treat them as product surface, not comments.
- The MCP registration is user-scoped and shared by every project:
  `claude mcp add --transport http todo-mcp http://127.0.0.1:4321/mcp --scope user`. The server does
  not start automatically; if it is down, MCP calls simply fail.
