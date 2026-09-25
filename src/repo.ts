import type { DatabaseSync } from 'node:sqlite';

export const STATUSES = ['open', 'in_progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/** The statuses that mean "still on my plate". */
export const ACTIVE_STATUSES: Status[] = ['open', 'in_progress'];

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

/**
 * Which end of the thread a comment came from. Not a user account — there is exactly one human
 * here — but the two surfaces that can write: the web UI (`user`) and an MCP client (`agent`).
 */
export const COMMENT_AUTHORS = ['user', 'agent'] as const;
export type CommentAuthor = (typeof COMMENT_AUTHORS)[number];

/**
 * A todo tied to one Azure DevOps work item. The link only exists here — nothing in DevOps knows
 * about it — and it carries its own push bookkeeping, since an agent's fire-and-forget push has
 * nowhere else to leave a failure for the human to find.
 */
export type DevOpsLink = {
  todo_id: number;
  work_item_id: number;
  /** Only used to build a clickable link; the id alone identifies the item org-wide. */
  project: string;
  work_item_type: string;
  work_item_title: string;
  /** The state DevOps last reported, and the one we last wrote successfully ('' = never). */
  remote_state: string;
  pushed_state: string;
  pushed_at: number | null;
  /** The last failed push, cleared by the next successful one. */
  error: string | null;
  error_at: number | null;
  created_at: number;
};

export type Todo = {
  id: number;
  /** Never empty; agents file exactly one, the human can attach the item to several. */
  repos: string[];
  title: string;
  description: string;
  status: Status;
  /** Human-only marker that floats an item above the `updated_at` ordering. */
  pinned: boolean;
  /** Human-only "this matters" marker. Purely visual — unlike `pinned`, it does not affect order. */
  important: boolean;
  /** The linked work item, or null. Human-only: agents never see or set it. */
  devops: DevOpsLink | null;
  created_at: number;
  updated_at: number;
};

export type TodoListItem = Todo & { comment_count: number };

export type TodoFilter = { repos?: string[]; statuses?: Status[]; query?: string };

/** Enough to tell "has anything arrived since I loaded?" without shipping the list again. */
export type TodoHead = { count: number; latest: number };

export type Comment = {
  id: number;
  todo_id: number;
  body: string;
  /** Set by whichever surface wrote it; editing a note never changes who it came from. */
  author: CommentAuthor;
  /**
   * The project the writing agent works in, which need not be the todo's repo (a frontend agent
   * answering on a backend item). Always null for `user`; null on an `agent` note means it predates
   * this being recorded.
   */
  agent_repo: string | null;
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

/**
 * Same trick for the work item link: one row still carries one todo, and an unlinked todo simply
 * gets SQL NULL here rather than a join that would have to be filtered out again.
 */
const DEVOPS_JSON = `(SELECT json_object(
                        'todo_id', d.todo_id,
                        'work_item_id', d.work_item_id,
                        'project', d.project,
                        'work_item_type', d.work_item_type,
                        'work_item_title', d.work_item_title,
                        'remote_state', d.remote_state,
                        'pushed_state', d.pushed_state,
                        'pushed_at', d.pushed_at,
                        'error', d.error,
                        'error_at', d.error_at,
                        'created_at', d.created_at)
                      FROM todo_devops d WHERE d.todo_id = t.id)`;

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
    pinned: num(row.pinned) === 1,
    important: num(row.important) === 1,
    // NULL when nothing is linked; json_object already produced JS-shaped numbers and nulls.
    devops: row.devops ? (JSON.parse(row.devops as string) as DevOpsLink) : null,
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

/** `%` and `_` are wildcards in LIKE, so a search for "50%" must not match everything. */
function likeTerm(query: string): string {
  return `%${query.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function toComment(row: Row): Comment {
  return {
    id: num(row.id),
    todo_id: num(row.todo_id),
    body: row.body as string,
    author: row.author as CommentAuthor,
    agent_repo: (row.agent_repo as string | null) ?? null,
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

/** Everything that touches SQL lives here; the MCP tools and the JSON API both go through it. */
export class TodoStore {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * The WHERE shared by the list and its head, so a "what changed?" poll can never disagree with
   * what the list would return. `repos` is an OR over repo names — a todo matches if any of its
   * repos is listed; empty means every repo.
   */
  private buildFilter(filter: TodoFilter): { sql: string; params: (string | number)[] } {
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
    if (filter.query) {
      // Substring match on both text fields. SQLite's LIKE only folds case for ASCII, so an
      // accented capital will not match its lowercase form — good enough for a personal list.
      where.push(`(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')`);
      params.push(likeTerm(filter.query), likeTerm(filter.query));
    }

    return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
  }

  listTodos(filter: TodoFilter = {}): TodoListItem[] {
    const { sql, params } = this.buildFilter(filter);
    const rows = this.db
      .prepare(
        `SELECT t.*, ${REPOS_JSON} AS repos, ${DEVOPS_JSON} AS devops,
                (SELECT COUNT(*) FROM comments c WHERE c.todo_id = t.id) AS comment_count
         FROM todos t
         ${sql}
         ORDER BY t.pinned DESC, t.updated_at DESC, t.id DESC`,
      )
      .all(...params) as Row[];

    return rows.map((row) => ({ ...toTodo(row), comment_count: num(row.comment_count) }));
  }

  /** Size and freshness of what `listTodos` would return, for the "new items arrived" check. */
  headTodos(filter: TodoFilter = {}): TodoHead {
    const { sql, params } = this.buildFilter(filter);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(MAX(t.updated_at), 0) AS latest FROM todos t ${sql}`,
      )
      .get(...params) as Row;
    return { count: num(row.count), latest: num(row.latest) };
  }

  getTodo(id: number): Todo | undefined {
    const row = this.db
      .prepare(
        `SELECT t.*, ${REPOS_JSON} AS repos, ${DEVOPS_JSON} AS devops FROM todos t WHERE t.id = ?`,
      )
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
    patch: {
      repos?: string[];
      title?: string;
      description?: string;
      status?: Status;
      pinned?: boolean;
      important?: boolean;
    },
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
    if (patch.pinned !== undefined) {
      sets.push('pinned = ?');
      params.push(patch.pinned ? 1 : 0);
    }
    if (patch.important !== undefined) {
      sets.push('important = ?');
      params.push(patch.important ? 1 : 0);
    }
    if (patch.repos !== undefined) this.setRepos(id, patch.repos);

    // Re-pinning an item to other repos is activity, so it bumps updated_at like an edit does.
    // Kitűzés and the importance marker are not: both are shelf position, not work done, and
    // bumping would make toggling either one leave the item stuck at the top of a list that
    // claims to be ordered by activity.
    const activity =
      patch.repos !== undefined ||
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.status !== undefined;
    if (activity) {
      sets.push('updated_at = ?');
      params.push(Date.now());
    }

    if (sets.length > 0) {
      params.push(id);
      this.db.prepare(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
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

  /**
   * Adding a comment counts as activity, so the parent todo bubbles up the list. `author` is not
   * taken from the request body anywhere — each caller passes the side it *is*, so an agent cannot
   * file a note as the human. `agentRepo` is only kept for `agent` notes — the human has no repo.
   */
  addComment(
    todoId: number,
    body: string,
    author: CommentAuthor,
    agentRepo: string | null = null,
  ): Comment | undefined {
    if (!this.getTodo(todoId)) return undefined;
    const now = Date.now();
    const result = this.db
      .prepare(
        `INSERT INTO comments (todo_id, body, author, agent_repo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(todoId, body, author, author === 'agent' ? agentRepo : null, now, now);
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

  /**
   * Rename a repo everywhere, which doubles as a merge when the target already exists — the fix
   * for an agent that spelled the folder name a different way once. Returns how many todos were
   * touched. Deliberately does not bump `updated_at`: housekeeping is not activity, and it would
   * reshuffle the whole list.
   */
  renameRepo(from: string, to: string): number {
    const target = to.trim();
    if (target === '' || target === from) return 0;

    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM todo_repos WHERE repo = ?')
      .get(from) as Row;
    const affected = num(row.count);
    if (affected === 0) return 0;

    // OR IGNORE: a todo already filed under both names collides on the primary key — it is simply
    // already merged, and the leftover row under the old name goes in the DELETE below.
    this.db.prepare('UPDATE OR IGNORE todo_repos SET repo = ? WHERE repo = ?').run(target, from);
    this.db.prepare('DELETE FROM todo_repos WHERE repo = ?').run(from);
    return affected;
  }

  /** Every stored setting as a plain map. Absent keys simply do not appear. */
  readSettings(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Row[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key as string] = row.value as string;
    return settings;
  }

  /** Upsert one key; an empty value is stored as such, `deleteSetting` is how a key goes away. */
  writeSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  getDevOpsLink(todoId: number): DevOpsLink | undefined {
    const row = this.db.prepare('SELECT * FROM todo_devops WHERE todo_id = ?').get(todoId) as
      | Row
      | undefined;
    return row ? toDevOpsLink(row) : undefined;
  }

  /** Which todo already claims this work item, if any — the 1:1 rule needs a name for the clash. */
  findDevOpsLinkByWorkItem(workItemId: number): DevOpsLink | undefined {
    const row = this.db
      .prepare('SELECT * FROM todo_devops WHERE work_item_id = ?')
      .get(workItemId) as Row | undefined;
    return row ? toDevOpsLink(row) : undefined;
  }

  /**
   * Link a work item, replacing whatever this todo pointed at before. The push bookkeeping starts
   * empty: linking is only a record, it never writes to DevOps, so nothing has been pushed yet.
   *
   * Deliberately does not bump `updated_at` — like kitűzés and fontos, this is a label on the item
   * rather than work done on it, and bumping would shuffle the list for a piece of admin.
   */
  setDevOpsLink(
    todoId: number,
    item: { work_item_id: number; project: string; work_item_type: string; work_item_title: string; remote_state: string },
  ): DevOpsLink | undefined {
    if (!this.getTodo(todoId)) return undefined;
    this.db
      .prepare(
        `INSERT INTO todo_devops
           (todo_id, work_item_id, project, work_item_type, work_item_title, remote_state,
            pushed_state, pushed_at, error, error_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, '', NULL, NULL, NULL, ?)
         ON CONFLICT(todo_id) DO UPDATE SET
           work_item_id = excluded.work_item_id,
           project = excluded.project,
           work_item_type = excluded.work_item_type,
           work_item_title = excluded.work_item_title,
           remote_state = excluded.remote_state,
           pushed_state = '', pushed_at = NULL, error = NULL, error_at = NULL`,
      )
      .run(
        todoId,
        item.work_item_id,
        item.project,
        item.work_item_type,
        item.work_item_title,
        item.remote_state,
        Date.now(),
      );
    return this.getDevOpsLink(todoId);
  }

  deleteDevOpsLink(todoId: number): boolean {
    const result = this.db.prepare('DELETE FROM todo_devops WHERE todo_id = ?').run(todoId);
    return Number(result.changes) > 0;
  }

  /** A push that landed: record what we wrote and refresh the cached fields from the response. */
  recordDevOpsPush(
    todoId: number,
    pushed: { state: string; work_item_type: string; work_item_title: string; project: string },
  ): void {
    this.db
      .prepare(
        `UPDATE todo_devops
         SET pushed_state = ?, remote_state = ?, pushed_at = ?,
             work_item_type = ?, work_item_title = ?, project = ?,
             error = NULL, error_at = NULL
         WHERE todo_id = ?`,
      )
      .run(
        pushed.state,
        pushed.state,
        Date.now(),
        pushed.work_item_type,
        pushed.work_item_title,
        pushed.project,
        todoId,
      );
  }

  /** A push that did not land. `pushed_state` is left alone: it still says what DevOps last got. */
  recordDevOpsFailure(todoId: number, message: string): void {
    this.db
      .prepare('UPDATE todo_devops SET error = ?, error_at = ? WHERE todo_id = ?')
      .run(message, Date.now(), todoId);
  }
}

function toDevOpsLink(row: Row): DevOpsLink {
  return {
    todo_id: num(row.todo_id),
    work_item_id: num(row.work_item_id),
    project: row.project as string,
    work_item_type: row.work_item_type as string,
    work_item_title: row.work_item_title as string,
    remote_state: row.remote_state as string,
    pushed_state: row.pushed_state as string,
    pushed_at: row.pushed_at === null ? null : num(row.pushed_at),
    error: (row.error as string | null) ?? null,
    error_at: row.error_at === null ? null : num(row.error_at),
    created_at: num(row.created_at),
  };
}
