/** Mirrors src/repo.ts on the server side. Keep the two in sync by hand. */

export const STATUSES = ['open', 'in_progress', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * A todo tied to one Azure DevOps work item. The link lives only here — nothing in DevOps records
 * it — and it carries its own push bookkeeping, because a push started by an agent over MCP has
 * nowhere else to report a failure.
 */
export type DevOpsLink = {
  todo_id: number;
  work_item_id: number;
  /** Only used to build the browser link; the id alone identifies the item org-wide. */
  project: string;
  work_item_type: string;
  work_item_title: string;
  /** What DevOps last reported, and what we last managed to write ('' = never pushed). */
  remote_state: string;
  pushed_state: string;
  pushed_at: number | null;
  /** The last failed push, cleared by the next successful one. */
  error: string | null;
  error_at: number | null;
  created_at: number;
};

/** The stored connection as it leaves the server: the PAT itself never crosses that boundary. */
export type DevOpsSettings = {
  org: string;
  stateInProgress: string;
  stateClosed: string;
  hasPat: boolean;
  /** True when a push could actually be attempted — this is what hides or shows the feature. */
  configured: boolean;
};

export type Todo = {
  id: number;
  /** Never empty. An agent files exactly one, but the UI can pin an item to several repos. */
  repos: string[];
  title: string;
  description: string;
  status: Status;
  /** Kitűzve: floats above the `updated_at` ordering. Not something an agent can set. */
  pinned: boolean;
  /** Fontos: purely visual marker, does not affect ordering. Not something an agent can set. */
  important: boolean;
  /** The linked work item, or null. Human-only: agents never see or set it. */
  devops: DevOpsLink | null;
  created_at: number;
  updated_at: number;
};

export type TodoListItem = Todo & { comment_count: number };

/** Size + freshness of the current filter's list, polled to spot todos that arrived over MCP. */
export type TodoHead = { count: number; latest: number };

/** Which side of the thread a comment came from: the web UI or an agent over MCP. */
export const COMMENT_AUTHORS = ['user', 'agent'] as const;
export type CommentAuthor = (typeof COMMENT_AUTHORS)[number];

export type Comment = {
  id: number;
  todo_id: number;
  body: string;
  /** Set server-side by the surface that wrote it; editing here does not change it. */
  author: CommentAuthor;
  /** The writing agent's own project; null for `user`, and on agent notes predating it. */
  agent_repo: string | null;
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

/**
 * The reader here is the human, so their own notes are "Én" and the other side gets the name they
 * actually call it. The stored value stays `agent`, since any MCP client can write a note.
 */
export const COMMENT_AUTHOR_LABELS: Record<CommentAuthor, string> = {
  user: 'Én',
  agent: 'Claude',
};
