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

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  todo_id    INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_todo ON comments(todo_id, id);
`;

/**
 * Move a pre-multi-repo database over: the old single `todos.repo` column becomes the first (and
 * only) `todo_repos` row. Detected by the column still being there, so it runs exactly once.
 */
function migrateRepoColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(todos)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'repo')) return;

  db.exec(`
    INSERT OR IGNORE INTO todo_repos (todo_id, repo) SELECT id, repo FROM todos;
    DROP INDEX IF EXISTS idx_todos_repo_status;
    ALTER TABLE todos DROP COLUMN repo;
  `);
}

export function openDb(path = DB_PATH): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrateRepoColumn(db);
  return db;
}
