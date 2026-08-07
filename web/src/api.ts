import type {
  Comment,
  RepoSummary,
  Status,
  StatusFilter,
  Todo,
  TodoHead,
  TodoListItem,
} from './types';

/**
 * Set by `request` when the service worker answered from its cache because the server was
 * unreachable. The caller clears it before a load and reads it after — so it means "something on
 * screen is stale", which is exactly what the UI badge says.
 */
export const cacheFlag = { stale: false };

/**
 * Called after every successful write. The "something changed on the server" poll uses it to
 * re-sync, so your own edit never comes back at you as news. Module-level for the same reason as
 * `cacheFlag`: every write already funnels through `request`, whereas a callback threaded through
 * each component that can edit something would drift the moment a new one is added.
 */
let mutationListener: (() => void) | null = null;

export function onMutation(listener: (() => void) | null): void {
  mutationListener = listener;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  /** Background polls must not touch `cacheFlag` — only what is on screen can be stale. */
  options: { trackCache?: boolean } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    // Network-level failure: the server is down (writes are not served from the cache at all).
    throw new Error('A szerver nem érhető el.');
  }

  if (options.trackCache !== false && response.headers.get('X-Todo-Mcp-Cached')) {
    cacheFlag.stale = true;
  }

  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(message ?? `${response.status} ${response.statusText}`);
  }

  const method = init?.method ?? 'GET';
  if (method !== 'GET') mutationListener?.();

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export type TodoQuery = { repos: string[]; status: StatusFilter; query?: string };

/** An empty `repos` means every repo; several names are sent as repeated `repo` params. */
function todoParams(filter: TodoQuery): string {
  const params = new URLSearchParams();
  for (const repo of filter.repos) params.append('repo', repo);
  params.set('status', filter.status);
  if (filter.query) params.set('q', filter.query);
  return params.toString();
}

export function fetchTodos(filter: TodoQuery): Promise<TodoListItem[]> {
  return request<TodoListItem[]>(`/todos?${todoParams(filter)}`);
}

/** Cheap poll: how many items match now, and how fresh the freshest one is. */
export function fetchTodosHead(filter: TodoQuery): Promise<TodoHead> {
  return request<TodoHead>(`/todos/head?${todoParams(filter)}`, undefined, { trackCache: false });
}

export function fetchRepos(): Promise<RepoSummary[]> {
  return request<RepoSummary[]>('/repos');
}

export function createTodo(input: {
  repos: string[];
  title: string;
  description: string;
}): Promise<Todo> {
  return request<Todo>('/todos', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTodo(
  id: number,
  patch: {
    repos?: string[];
    title?: string;
    description?: string;
    status?: Status;
    pinned?: boolean;
  },
): Promise<Todo> {
  return request<Todo>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

/** Renames everywhere; merges if `name` is already an existing repo. Returns the todos touched. */
export function renameRepo(repo: string, name: string): Promise<{ updated: number }> {
  return request<{ updated: number }>(`/repos/${encodeURIComponent(repo)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

export function deleteTodo(id: number): Promise<void> {
  return request<void>(`/todos/${id}`, { method: 'DELETE' });
}

export function fetchComments(todoId: number): Promise<Comment[]> {
  return request<Comment[]>(`/todos/${todoId}/comments`);
}

export function createComment(todoId: number, body: string): Promise<Comment> {
  return request<Comment>(`/todos/${todoId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export function updateComment(id: number, body: string): Promise<Comment> {
  return request<Comment>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
}

export function deleteComment(id: number): Promise<void> {
  return request<void>(`/comments/${id}`, { method: 'DELETE' });
}
