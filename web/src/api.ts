import type { Comment, RepoSummary, Status, StatusFilter, Todo, TodoListItem } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });

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

export function fetchTodos(filter: { repo: string; status: StatusFilter }): Promise<TodoListItem[]> {
  const params = new URLSearchParams();
  if (filter.repo) params.set('repo', filter.repo);
  params.set('status', filter.status);
  return request<TodoListItem[]>(`/todos?${params.toString()}`);
}

export function fetchRepos(): Promise<RepoSummary[]> {
  return request<RepoSummary[]>('/repos');
}

export function createTodo(input: {
  repo: string;
  title: string;
  description: string;
}): Promise<Todo> {
  return request<Todo>('/todos', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTodo(
  id: number,
  patch: { title?: string; description?: string; status?: Status },
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
