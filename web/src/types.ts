/** Mirrors src/repo.ts on the server side. Keep the two in sync by hand. */

export const STATUSES = ['open', 'in_progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

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
