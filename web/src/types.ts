/** Mirrors src/repo.ts on the server side. Keep the two in sync by hand. */

export const STATUSES = ['open', 'in_progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

export type Todo = {
  id: number;
  /** Never empty. An agent files exactly one, but the UI can pin an item to several repos. */
  repos: string[];
  title: string;
  description: string;
  status: Status;
  /** Kitűzve: floats above the `updated_at` ordering. Not something an agent can set. */
  pinned: boolean;
  created_at: number;
  updated_at: number;
};

export type TodoListItem = Todo & { comment_count: number };

/** Size + freshness of the current filter's list, polled to spot todos that arrived over MCP. */
export type TodoHead = { count: number; latest: number };

export type Comment = {
  id: number;
  todo_id: number;
  body: string;
  created_at: number;
  updated_at: number;
};

export type RepoSummary = { repo: string; active_count: number };

/** What the status filter can be set to: a single status, only active ones, or everything. */
export type StatusFilter = Status | 'active' | 'all';

export const STATUS_LABELS: Record<Status, string> = {
  open: 'nyitott',
  in_progress: 'folyamatban',
  closed: 'lezárt',
};

export const STATUS_COLORS: Record<Status, 'warning' | 'info' | 'success'> = {
  open: 'warning',
  in_progress: 'info',
  closed: 'success',
};
