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
  repo: string;
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

type Row = Record<string, unknown>;

function num(value: unknown): number {
  return typeof value === 'bigint' ? Number(value) : (value as number);
}

function toTodo(row: Row): Todo {
  return {
    id: num(row.id),
    repo: row.repo as string,
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

  listTodos(filter: { repo?: string; statuses?: Status[] } = {}): TodoListItem[] {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (filter.repo) {
      where.push('t.repo = ?');
      params.push(filter.repo);
    }
    if (filter.statuses && filter.statuses.length > 0) {
      where.push(`t.status IN (${filter.statuses.map(() => '?').join(', ')})`);
      params.push(...filter.statuses);
    }

    const rows = this.db
      .prepare(
        `SELECT t.*, (SELECT COUNT(*) FROM comments c WHERE c.todo_id = t.id) AS comment_count
         FROM todos t
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY t.updated_at DESC, t.id DESC`,
      )
      .all(...params) as Row[];

    return rows.map((row) => ({ ...toTodo(row), comment_count: num(row.comment_count) }));
  }

  getTodo(id: number): Todo | undefined {
    const row = this.db.prepare('SELECT * FROM todos WHERE id = ?').get(id) as Row | undefined;
    return row ? toTodo(row) : undefined;
  }

  createTodo(input: { repo: string; title: string; description?: string }): Todo {
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO todos (repo, title, description, status, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?)`,
      )
      .run(input.repo, input.title, input.description ?? '', now, now);
    return this.getTodo(Number(result.lastInsertRowid))!;
  }

  updateTodo(
    id: number,
    patch: { title?: string; description?: string; status?: Status },
  ): Todo | undefined {
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
    if (sets.length === 0) return this.getTodo(id);

    sets.push('updated_at = ?');
    params.push(Date.now(), id);

    this.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return this.getTodo(id);
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

  /** Repo names seen so far, with their active counts — feeds the UI filter and combobox. */
  listRepos(): { repo: string; active_count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT repo,
                SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS active_count
         FROM todos
         GROUP BY repo
         ORDER BY repo COLLATE NOCASE ASC`,
      )
      .all() as Row[];
    return rows.map((row) => ({ repo: row.repo as string, active_count: num(row.active_count) }));
  }
}
