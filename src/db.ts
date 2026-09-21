import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS todos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','in_progress','closed')),
  pinned      INTEGER NOT NULL DEFAULT 0,
  important   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_updated ON todos(updated_at DESC);

-- A todo belongs to one or more repos. Agents only ever file one; the human can add more.
-- Membership order is the insertion order (rowid), so the UI can show them as the human typed them.
CREATE TABLE IF NOT EXISTS todo_repos (
  todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  repo    TEXT NOT NULL,
  PRIMARY KEY (todo_id, repo)
);
CREATE INDEX IF NOT EXISTS idx_todo_repos_repo ON todo_repos(repo);

-- One thread per todo, written from both ends: the author column records which end a note came
-- from, since the human reading the wall and the agent reading get_ticket must tell them apart.
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id    INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  author     TEXT NOT NULL DEFAULT 'user'
             CHECK (author IN ('user','agent')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_todo ON comments(todo_id, id);

-- Single-row-per-key store for the Azure DevOps connection (organization, PAT, the two state
-- names). Not in config.ts with the rest: the packaged desktop app has no shell to export env
-- vars into, so these are edited in the web UI instead.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The todo <-> Azure DevOps work item link. Ours alone: nothing in DevOps records that it exists.
-- Strictly one-to-one in both directions (todo_id is the key, work_item_id is unique), and the
-- push bookkeeping lives here too, because a fire-and-forget push from an agent has no other place
-- to report a failure to.
CREATE TABLE IF NOT EXISTS todo_devops (
  todo_id         INTEGER PRIMARY KEY REFERENCES todos(id) ON DELETE CASCADE,
  work_item_id    INTEGER NOT NULL UNIQUE,
  project         TEXT NOT NULL DEFAULT '',
  work_item_type  TEXT NOT NULL DEFAULT '',
  work_item_title TEXT NOT NULL DEFAULT '',
  -- What DevOps last told us it was in, and what we last managed to write ('' = never pushed).
  remote_state    TEXT NOT NULL DEFAULT '',
  pushed_state    TEXT NOT NULL DEFAULT '',
  pushed_at       INTEGER,
  -- Last failed push, cleared by the next successful one.
  error           TEXT,
  error_at        INTEGER,
  created_at      INTEGER NOT NULL
);
`;

/**
 * Bring an older database up to the current shape. Each step keys off what is actually in the
 * table, so it is safe to run on every open and there is no version counter to keep in sync.
 */
function migrate(db: DatabaseSync): void {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(todos)').all() as { name: string }[]).map((c) => c.name),
  );

  // Pre-multi-repo: the old single `todos.repo` becomes the first (and only) `todo_repos` row.
  if (columns.has('repo')) {
    db.exec(`
      INSERT OR IGNORE INTO todo_repos (todo_id, repo) SELECT id, repo FROM todos;
      DROP INDEX IF EXISTS idx_todos_repo_status;
      ALTER TABLE todos DROP COLUMN repo;
    `);
  }

  // Pinning came later; everything already recorded starts unpinned.
  if (!columns.has('pinned')) {
    db.exec('ALTER TABLE todos ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  }

  // Importance marking came later still; everything already recorded starts unmarked.
  if (!columns.has('important')) {
    db.exec('ALTER TABLE todos ADD COLUMN important INTEGER NOT NULL DEFAULT 0');
  }

  const commentColumns = new Set(
    (db.prepare('PRAGMA table_info(comments)').all() as { name: string }[]).map((c) => c.name),
  );

  // Comment authorship came later. Nothing recorded who wrote the existing notes, so they all
  // become 'user' — the human's own thread is by far the likelier origin, and claiming an agent
  // wrote something it did not would be the worse mistake of the two.
  if (!commentColumns.has('author')) {
    db.exec(`ALTER TABLE comments ADD COLUMN author TEXT NOT NULL DEFAULT 'user'`);
  }
}

export function openDb(path = DB_PATH): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
