# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An MCP server plus a small React web app for parking questions that come up while a coding agent
works but need a **human decision**. The agent files items with `add_todo` and moves on; the human
triages them in the browser. There is deliberately **no push back to the agent** — `add_todo` returns
only a confirmation and `list_todos` never exposes the human's comments or decisions, so nothing an
agent does here can turn into waiting for an answer. `get_ticket(id)` is the one **pull**: when the
human tells an agent "do #12", it can read that item in full, comments included. `update_ticket` is
the report back — an agent may comment and set `in_progress`, but **not close**: closing is the
human's verdict. The invariant to preserve is that no agent ever has a reason to wait or poll.

`specification.md` is the original (Hungarian) sketch; `README.md` is the user-facing doc, also in
Hungarian. The UI strings are Hungarian; all code, comments and identifiers are English.

## Commands

```bash
npm install
npm run build      # tsc (server → dist/) + tsc --noEmit (web typecheck) + vite build (→ dist/web/)
npm start          # serves API + MCP + built SPA on http://127.0.0.1:4321
npm run dev:server # same, with node --watch over dist/ (needs a build first)
npm run dev:web    # Vite dev server with HMR, proxies /api to the running server
npm run icons      # regenerate the PWA icons in web/public (see tools/make-icons.mjs)
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

Its counterpart: **all Azure DevOps HTTP lives in `src/devops.ts`**, which knows nothing about the
data model, and `TodoService` (`src/service.ts`) is the thin layer that joins the two. A status
change is the one operation with two sides, so both surfaces call `service.updateTodo` rather than
`store.updateTodo` — that is what keeps the web UI and the MCP tool from drifting on which
transitions mirror to DevOps. `server.ts` builds one `TodoService` and hands it to both.

Data model (`src/db.ts`, schema applied idempotently on every open): `todos` (title, description,
status ∈ `open|in_progress|closed`, `pinned`, `important`, timestamps as epoch ms), `todo_repos`,
`comments` and `todo_devops`, the last three with `ON DELETE CASCADE`, plus a key/value `settings`
table. The three later tables need no `migrate()` step: `CREATE TABLE IF NOT EXISTS` on every open
is the whole migration for a table that is simply new. Writing or editing a comment also bumps the
parent todo's `updated_at`, since lists are ordered `pinned DESC, updated_at DESC` — activity floats
an item to the top; so does re-pinning an item to other repos. **Kitűzés deliberately does not bump
`updated_at`** (`TodoStore.updateTodo` tracks that as `activity`): it is a shelf position, and
bumping would leave an unpinned item stuck at the top of a list that claims to be ordered by
activity. **Fontos (`important`) follows the same rule for the same reason**, but is otherwise
unrelated to `pinned`: it is a purely visual "this matters" marker (a red flag badge in the UI) and
never affects ordering — the two are independent booleans an item can carry in any combination.

A comment carries an **`author` ∈ `user|agent`** (`CommentAuthor` in `repo.ts`), because the one
thread is written from both ends: the human needs to tell their own decision from an agent's
progress note, and `get_ticket` has to say which of its comments are the agent's own earlier notes
rather than an answer. It is never taken from a request body — `TodoStore.addComment` requires it
and each surface passes the side it *is* (`api.ts` → `user`, `mcp.ts` → `agent`), so an agent cannot
file a note as the human. Editing a comment leaves the author alone. Migrated databases get `user`
for every pre-existing comment: nothing recorded the origin, and falsely crediting an agent would be
the worse of the two mistakes.

An agent comment also carries **`agent_repo`**: the project the *writing* agent works in, which is
not necessarily the todo's repo — a frontend agent can comment on a backend item. `update_ticket`
therefore takes a required `repo` (the caller's own), `get_ticket` prints `[agent from repo X]`, and
`CommentThread` shows it as a chip. It is always NULL for `user`; NULL on an `agent` comment means
the note predates the column, and both surfaces say so rather than guessing the todo's repo.

`migrate()` in `db.ts` is the one place for schema evolution. Each step keys off what `PRAGMA
table_info` actually reports rather than a version counter, so it is safe on every open — that is
how the `repo` column removal and the later `pinned`/`important` additions all work. It reads a
second `PRAGMA table_info` for `comments` (the `author` column), since that step is not about
`todos` at all.

Repo membership is **many-to-many**, and that asymmetry is the point: an agent files under exactly
one repo (`add_todo` takes a single `repo` string), while the human can pin an item to several in the
UI. `todo_repos` is the only source of truth — `todos.repo` is gone, and `openDb` migrates an old
database by copying that column into `todo_repos` and dropping it (detected by the column still
existing, so it runs once). Membership order is `rowid` order, i.e. the order last submitted;
`TodoStore.setRepos` rewrites the set wholesale. Repo lists reach JS as a `json_group_array`
sub-select (`REPOS_JSON` in `repo.ts`), so one row still carries one todo — filtering is an `EXISTS`,
never a join that could duplicate rows.

Storage is a **single global SQLite file** at `~/.todo-mcp/todos.db` (override with `TODO_MCP_DB`),
shared across all projects; repo membership is the only separation. A repo name is expected to be the
basename of the project folder, and consistency depends on the agent spelling it the same each time —
hence the emphasis in the `add_todo` tool description, and `TodoStore.renameRepo` as the escape hatch
when it goes wrong anyway. Rename doubles as merge (`UPDATE OR IGNORE` + `DELETE` of the leftovers)
and does **not** bump `updated_at`: housekeeping is not activity, and it would reshuffle everything.

`listTodos`/`headTodos` share `buildFilter`, so the "has anything arrived?" poll can never disagree
with what the list itself would return. Search is a `LIKE` over title + description with `%`/`_`
escaped (`likeTerm`); SQLite only case-folds ASCII, so accented capitals do not match their lowercase
form — acceptable for a personal list, and the alternative is an ICU build.

### Azure DevOps

A todo can be tied to **one** work item, and the link exists only here — nothing in DevOps records
it. `todo_devops` is keyed by `todo_id` and unique on `work_item_id`, so the relation is 1:1 in both
directions: without the second constraint the first close would resolve a work item while another
todo pointing at it is still open. Linking **never pushes** — it reads the item back to prove it
exists and to cache its project, type and title, and the DevOps side stays untouched until the next
status change. Like `pinned` and `important`, linking does not bump `updated_at`: it is a label, not
work done.

Linking optionally copies the work item's **description and acceptance criteria** into the todo's
own description (`ImportFields` → `importedSections` in `service.ts`). It always **appends** under a
Hungarian heading, never replaces: what the human wrote is the part that cannot be recovered. That
append *is* content, so it does bump `updated_at` — unlike the link itself. Because of it, `POST
/todos/:id/devops` answers with the whole todo rather than just the link. Both fields are HTML on
the DevOps side, converted by `htmlToMarkdown` in `devops.ts` — hand-rolled rather than a
dependency, covering what the DevOps editor actually emits (paragraphs, breaks, ordered and
unordered lists, emphasis, links, table cells, entities) and dropping the rest of the markup.

`getWorkItem` deliberately sends **no `fields=` filter**: asking for a field a work item type does
not define is a 400 from this API, and `Microsoft.VSTS.Common.AcceptanceCriteria` is exactly such a
field — an Agile Task has none. The whole field bag costs a bigger response and never fails.

The mapping is `in_progress` → the configured "folyamatban" state, `closed` → the configured
"megoldva" state, and **`open` pushes nothing** — re-opening here is our own housekeeping, and a new
todo must not move a work item somebody else is watching. It runs in both directions, so
`closed → in_progress` walks the work item back. `targetState` in `service.ts` is the single place
that decides this. The PATCH is a **blind overwrite**: no revision check, because this wall is the
source of truth.

**The local status change never depends on DevOps.** The store write happens first and stands
whatever the push does; a failure is recorded on the link (`error`, `error_at`) rather than failing
the request. That is also why the link carries its own bookkeeping at all: `update_ticket` pushes
**fire-and-forget** (`wait: false`), since an agent must never wait on a network call, and a silent
failure would otherwise have nowhere to land. The web UI pushes with `wait: true` and reads the
failure off the returned todo (`pushFailure` in `web/src/DevOpsLink.tsx`) — only ever right after a
status change, since at any other moment the stored error may be an old one. Retry is manual only.

The MCP surface is deliberately **unchanged**: no tool mentions DevOps, `get_ticket` does not expose
the link, and linking is the human's job in the web UI. An agent moving an item to `in_progress`
moves the work item without knowing it exists.

Configuration lives in the `settings` table, not `config.ts`: the packaged Electron app has no shell
to export env vars into, so it is edited in the web UI (`DevOpsSettingsDialog`). Only the
organization, the PAT and the two state names are stored — **no project**, because a work item id is
unique organization-wide and `System.TeamProject` comes back with the item. The panel does make you
pick a project and a work item type, but only as a *reference* for the state dropdowns (valid states
are defined per type), and neither is saved. The PAT is **write-only across the API boundary**:
`GET /api/settings/devops` answers `hasPat`, never the token, and it never reaches a log. Omitting
`pat` on a save keeps the stored one; an empty string clears it. When nothing is configured, every
DevOps control hides itself — the header's settings button is the one entry point that must stay.

`/api/devops/*` is passed straight through the service worker, for the same reason as
`/api/todos/head`: a cached answer would describe another organization or a token that has since
changed, and serving one would flag the whole screen as stale over a lookup the todos do not use.

`src/config.ts` centralises host/port/paths. Port is `TODO_MCP_PORT` (default 4321), and
`ALLOWED_HOSTS` is derived from it — `/mcp` rejects any other `Host` header (DNS-rebinding guard,
replacing the SDK's deprecated option). No auth: single-user, single-machine, loopback only.

### Web SPA (`web/`)

React 19 + MUI 9 + Emotion, Vite with `root: 'web'`, built into `dist/web`. `web/src/types.ts`
**hand-mirrors** the server types from `src/repo.ts` — there is no shared package or codegen, so a
change to `Todo`/`Comment`/`Status`/`DevOpsLink` must be made in both files (`DevOpsSettings`
mirrors `DevOpsSettingsView` in `src/service.ts`). `web/src/api.ts` is the only place
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

`CommentThread` attributes every entry: an icon plus `COMMENT_AUTHOR_LABELS` ("Én" / "Claude") above
the body, and a coloured left edge on the agent's slips. The label is above the text, not next to the
timestamp underneath, because who wrote a note changes how it reads — a decision to follow versus a
report to check. The Hungarian labels name the two sides as the human thinks of them, while the
stored value stays `agent`; any MCP client can write a note, but it is Claude in practice.

The repo filter is a **multi-select**: checkable menu items plus deletable chips in the closed select,
so several repos can be watched side by side and dropped one at a time (empty selection = every repo).
It is a list all the way down — `GET /api/todos` takes a **repeated** `repo` param and `TodoStore.listTodos`
takes `repos: string[]` — so widening the filter never means filtering client-side.

Assigning repos is `RepoPicker`, one free-solo multi-Autocomplete shared by `NewTodoForm`, `TodoRow`
and `TodoDetailDialog` (the last two get the suggestions through `repoOptions`, threaded down from
`App`'s `itemProps`). Free-solo because an item can be pinned to a project that has no todos yet.
**A todo must keep at least one repo**: the pickers disable Save on an empty list, `POST`/`PATCH`
answer 400, and `setRepos` ignores an empty set — a repo-less todo would be invisible under every
filter. The board note has no room for a list, so it shows `first +N` with the rest in a tooltip.

Renaming a repo is an `EditOutlinedIcon` on each filter menu row (`RepoRenameDialog`). Both `onClick`
and `onMouseDown` must stop propagation there — a `Select` picks items up on mousedown, so without it
the rename button would also toggle the checkbox. Typing an existing name merges, and the dialog says
so before you commit.

The search box is debounced 300 ms into a separate `query` state, which is what `load` and the poll
depend on — the raw `search` value never reaches the server, so typing does not spam it.

The **work item link** is on all three surfaces too, but in three sizes: an inky badge on the note
(`WorkItemNoteBadge`), a chip on the row (`WorkItemChip`), and the full controls — link, unlink,
last successful push, error with a retry button — in the dialog and the expanded row
(`DevOpsSection`, all in `web/src/DevOpsLink.tsx`). The badge and the chip carry exactly two facts:
which work item, and whether the last push got there. Both stop propagation, or opening DevOps
would also open the note underneath.

A work item can also be attached straight from `NewTodoForm`, which does it in **two steps and in
this order**: the todo is created first and stands whatever happens next, then the link is
attempted. A mistyped number must not cost you the note you just wrote, so the failure is reported
while the todo stays — the same "local write never depends on DevOps" rule as the status push. Both
places share `ImportChoices` for the two import checkboxes, which default to on (the import only
appends, so saying yes cannot lose anything) and only appear once a reference has been typed.

**Kitűzés** (`pinned`), **fontos** (`important`) and **prompt copying** are on all three surfaces: the
note's hover toolbar, the row summary, and the dialog header. `prompt.ts` builds the paste-ready
Hungarian instruction — it is the bridge between the wall and the agent, so the only thing that has
to travel by hand is the number. The board note also carries quick status buttons; everything in
that toolbar stops propagation, and the note's own Enter/Space handler ignores events whose target is
not the note itself. Unlike the pin, the flag also renders **outside** the hover toolbar — a small red
`FlagIcon` badge in the note's top-left corner whenever `important` is set — since a marker meant to
say "this matters" would defeat its purpose if it only showed up on hover.

`board.ts` grows `ageStain`/`ageOverlay`: a note yellows from two weeks to two months since its last
activity, painted as a `mixBlendMode: multiply` `::before` wash with the dog-ear curling further.
Closed items never stain — the point is to make *neglect* visible, not age.

The UI **still never auto-refreshes**: todos arriving over MCP appear only after the user hits
*Frissítés*. What was added is a 30 s poll of `GET /api/todos/head` that only lights up a chip — the
list itself never changes under the user's hands. `baseline` (a ref, set on every load) is what the
poll compares against, and `api.onMutation` re-syncs it after every write, so your own edit never
comes back at you as news. The latest comparison is `>` rather than `!==` precisely so a baseline that
briefly runs ahead of the server cannot latch the chip on. When an inline edit makes an item stop
matching the current filter, it is kept in place until the next refresh rather than disappearing
mid-interaction.

### Installable app (PWA)

The SPA is installable, and that is a deliberate part of the product: the server does not start
automatically, so an installed app that opens from cache and *says* the server is down beats a
browser error page.

- `web/public/` holds the `manifest.webmanifest` and the icons. The PNGs are committed but generated
  by `tools/make-icons.mjs` (`npm run icons`) — a hand-rolled rasteriser + PNG encoder, no image
  deps, no downloads, matching the cork/post-it look. Edit the script, not the PNGs.
- `web/sw.js` is the service worker **template**, plain JS and outside the typecheck (it runs in
  worker scope). The `serviceWorker()` plugin in `vite.config.ts` substitutes the precache list (the
  hashed asset names are only known at bundle time) and a version hashed from everything precached,
  then emits `dist/web/sw.js`. Both placeholders are substituted with `replaceAll`, and the plugin
  errors if nothing was replaced — so do not mention them verbatim in prose inside `sw.js`.
- `/api/todos/head` is **passed straight through** the worker: a cached answer to "is there anything
  new?" is worse than none, and serving one would flag the whole screen as stale. `fetchTodosHead`
  additionally opts out of `cacheFlag` tracking, so a background poll can never claim the screen is
  showing cached data.
- Notifications are opt-in through the header's *Értesítés* button (browsers only honour the request
  from a user gesture) and only fire while the window is hidden — that is the case the feature exists
  for; when you are looking at the wall, the chip is enough.
- Strategies: cache-first for fingerprinted assets, network-first for navigations (falling back to
  the precached shell) and for `/api/*` GETs (falling back to the last successful response).
  `/mcp` and every non-GET is passed straight through — agent traffic and writes are never cached.
- A cache-served API response gets an `X-Todo-Mcp-Cached` header; `web/src/api.ts` turns that into
  `cacheFlag.stale`, which `App` clears before a load and reads after, and shows as a warning chip.
  Stale todos must never look current.
- `web/src/pwa.ts` owns registration (production builds only, so `dev:web` keeps its HMR), the
  `beforeinstallprompt` capture behind the header's *Telepítés* button, and the waiting-worker
  handshake that `UpdateSnackbar` offers. Updates are applied only when the user accepts — a
  self-triggered reload could eat an edit in progress.
- `src/server.ts` sends `Cache-Control: immutable` only for `/assets/*`; everything that keeps its
  URL across builds (shell, worker, manifest, icons) is `no-cache`, otherwise an installed app can
  get stuck on an old build.

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
  `GET_TICKET_DESCRIPTION` carries the same weight — it has to say "pull, on the user's cue" clearly
  enough that no agent starts polling it for a reply, and `UPDATE_TICKET_DESCRIPTION` has to explain
  *why* closing is missing rather than just omitting it, and say that its note lands on the thread
  marked as the agent's. Treat them as product surface, not comments.
- The MCP registration is user-scoped and shared by every project:
  `claude mcp add --transport http todo-mcp http://127.0.0.1:4321/mcp --scope user`. The server does
  not start automatically; if it is down, MCP calls simply fail.
