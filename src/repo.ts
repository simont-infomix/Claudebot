import type { DatabaseSync } from 'node:sqlite';

export const STATUSES = ['open', 'in_progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/** The statuses that mean "still on my plate". */
export const ACTIVE_STATUSES: Status[] = ['open', 'in_progress'];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

export type Todo = {
  id: number;
  /** Never empty; agents file exactly one, the human can attach the item to several. */
  repos: string[];
  title: string;
  description: string;
  status: Status;
  created_at: number;
  updated_at: number;
};

export type TodoListItem = Todo & { comment_count: number };

export type Comment = {
  id: number;
  todo_id: number;
  body: string;
  created_at: number;
  updated_at: number;
};

/** A todo with everything hanging off it — what `get_ticket` hands back. */
export type Ticket = Todo & { comments: Comment[] };

type Row = Record<string, unknown>;

/** Trimmed, de-duplicated, order preserved — the one place repo names are normalised. */
export function normaliseRepos(repos: string[]): string[] {
  const result: string[] = [];
  for (const repo of repos) {
    const trimmed = repo.trim();
    if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/** Correlated sub-select so a single row carries its whole repo list, in membership order. */
const REPOS_JSON = `(SELECT json_group_array(repo)
                     FROM (SELECT repo FROM todo_repos WHERE todo_id = t.id ORDER BY rowid))`;

function num(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : (value as number);
}

function toTodo(row: Row): Todo {
  return {
    id: num(row.id),
    repos: JSON.parse(row.repos as string) as string[],
    title: row.title as string,
    description: row.description as string,
    status: row.status as Status,
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

function toComment(row: Row): Comment {
  return {
    id: num(row.id),
    todo_id: num(row.todo_id),
    body: row.body as string,
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

/** Everything that touches SQL lives here; the MCP tools and the JSON API both go through it. */
export class TodoStore {
  constructor(private readonly db: DatabaseSync) {}

  /** `repos` is an OR over repo names — a todo matches if any of its repos is listed. Empty = all. */
  listTodos(filter: { repos?: string[]; statuses?: Status[] } = {}): TodoListItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.repos && filter.repos.length > 0) {
      where.push(
        `EXISTS (SELECT 1 FROM todo_repos r
                 WHERE r.todo_id = t.id AND r.repo IN (${filter.repos.map(() => '?').join(', ')}))`,
      );
      params.push(...filter.repos);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`t.status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }

    const rows = this.db
      .prepare(
        `SELECT t.*, ${REPOS_JSON} AS repos,
                (SELECT COUNT(*) FROM comments c WHERE c.todo_id = t.id) AS comment_count
         FROM todos t
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY t.updated_at DESC, t.id DESC`,
      )
      .all(...params) as Row[];

    return rows.map((row) => ({ ...toTodo(row), comment_count: num(row.comment_count) }));
  }

  getTodo(id: number): Todo | undefined {
    const row = this.db
      .prepare(`SELECT t.*, ${REPOS_JSON} AS repos FROM todos t WHERE t.id = ?`)
      .get(id) as Row | undefined;
    return row ? toTodo(row) : undefined;
  }

  /** The whole item in one go, comments included — the human's notes are part of it. */
  getTicket(id: number): Ticket | undefined {
    const todo = this.getTodo(id);
    return todo ? { ...todo, comments: this.listComments(id) } : undefined;
  }

  createTodo(input: { repos: string[]; title: string; description?: string }): Todo {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO todos (title, description, status, created_at, updated_at)
         VALUES (?, ?, 'open', ?, ?)`,
      )
      .run(input.title, input.description ?? '', now, now);
    const id = Number(result.lastInsertRowid);
    this.setRepos(id, input.repos);
    return this.getTodo(id)!;
  }

  updateTodo(
    id: number,
    patch: { repos?: string[]; title?: string; description?: string; status?: Status },
  ): Todo | undefined {
    if (!this.getTodo(id)) return undefined;

    const sets: string[] = [];
    const params: (string | number)[] = [];

    if (patch.title !== undefined) {
      sets.push('title = ?');
      params.push(patch.title);
    }
    if (patch.description !== undefined) {
      sets.push('description = ?');
      params.push(patch.description);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      params.push(patch.status);
    }

    // Re-pinning an item to other repos is activity too, so it bumps updated_at like the rest.
    if (patch.repos !== undefined) this.setRepos(id, patch.repos);
    else if (sets.length === 0) return this.getTodo(id);

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    this.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getTodo(id);
  }

  /** Replaces the whole membership set; callers guarantee at least one usable name. */
  private setRepos(todoId: number, repos: string[]): void {
    const wanted = normaliseRepos(repos);
    if (wanted.length === 0) return;

    // Rewritten wholesale, so the stored order is exactly the submitted one.
    this.db.prepare('DELETE FROM todo_repos WHERE todo_id = ?').run(todoId);
    const insert = this.db.prepare('INSERT INTO todo_repos (todo_id, repo) VALUES (?, ?)');
    for (const repo of wanted) insert.run(todoId, repo);
  }

  deleteTodo(id: number): boolean {
    const result = this.db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  listComments(todoId: number): Comment[] {
    const rows = this.db
      .prepare('SELECT * FROM comments WHERE todo_id = ? ORDER BY id ASC')
      .all(todoId) as Row[];
    return rows.map(toComment);
  }

  getComment(id: number): Comment | undefined {
    const row = this.db.prepare('SELECT * FROM comments WHERE id = ?').get(id) as Row | undefined;
    return row ? toComment(row) : undefined;
  }

  /** Adding a comment counts as activity, so the parent todo bubbles up the list. */
  addComment(todoId: number, body: string): Comment | undefined {
    if (!this.getTodo(todoId)) return undefined;
    const now = Date.now();
    const result = this.db
      .prepare('INSERT INTO comments (todo_id, body, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(todoId, body, now, now);
    this.db.prepare('UPDATE todos SET updated_at = ? WHERE id = ?').run(now, todoId);
    return this.getComment(Number(result.lastInsertRowid));
  }

  updateComment(id: number, body: string): Comment | undefined {
    const existing = this.getComment(id);
    if (!existing) return undefined;
    const now = Date.now();
    this.db.prepare('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?').run(body, now, id);
    this.db.prepare('UPDATE todos SET updated_at = ? WHERE id = ?').run(now, existing.todo_id);
    return this.getComment(id);
  }

  deleteComment(id: number): boolean {
    const result = this.db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    return Number(result.changes) > 0;
  }

  /**
   * Repo names seen so far, with their active counts — feeds the UI filter and combobox.
   * A todo pinned to several repos counts once in each of them.
   */
  listRepos(): { repo: string; active_count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT r.repo AS repo,
                SUM(CASE WHEN t.status IN ('open','in_progress') THEN 1 ELSE 0 END) AS active_count
         FROM todo_repos r
         JOIN todos t ON t.id = r.todo_id
         GROUP BY r.repo
         ORDER BY r.repo COLLATE NOCASE ASC`,
      )
      .all() as Row[];
    return rows.map((row) => ({ repo: row.repo as string, active_count: num(row.active_count) }));
  }
}
