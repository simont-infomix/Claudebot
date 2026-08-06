import type { Comment, RepoSummary, Status, StatusFilter, Todo, TodoListItem } from './types';

/**
 * Set by `request` when the service worker answered from its cache because the server was
 * unreachable. The caller clears it before a load and reads it after — so it means "something on
 * screen is stale", which is exactly what the UI badge says.
 */
export const cacheFlag = { stale: false };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  if (response.headers.get('X-Todo-Mcp-Cached')) cacheFlag.stale = true;

  if (!response.ok) {
    const message = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(message ?? `${response.status} ${response.statusText}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** An empty `repos` means every repo; several names are sent as repeated `repo` params. */
export function fetchTodos(filter: {
  repos: string[];
  status: StatusFilter;
}): Promise<TodoListItem[]> {
  const params = new URLSearchParams();
  for (const repo of filter.repos) params.append('repo', repo);
  params.set('status', filter.status);
  return request<TodoListItem[]>(`/todos?${params.toString()}`);
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
  patch: { repos?: string[]; title?: string; description?: string; status?: Status },
): Promise<Todo> {
  return request<Todo>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
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
