import { Router, type Request, type Response } from 'express';
import { ACTIVE_STATUSES, isStatus, normaliseRepos, type Status, type TodoStore } from './repo.js';

function badRequest(res: Response, error: string): void {
  res.status(400).json({ error });
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

function parseId(req: Request, res: Response): number | undefined {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    badRequest(res, 'Invalid id');
    return undefined;
  }
  return id;
}

/**
 * The repo list from a request body, normalised. `null` means "not a list of strings" and
 * an empty array means "nothing usable in it" — both are rejected by the callers, since a todo
 * with no repo would be invisible under every filter.
 */
function parseRepos(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== 'string')) return null;
  return normaliseRepos(value as string[]);
}

/** Non-empty trimmed string, or undefined if absent; null if present but not a usable string. */
function optionalText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return null;
  return value;
}

export function createApiRouter(store: TodoStore): Router {
  const router = Router();

  router.get('/todos', (req, res) => {
    // `repo` may repeat — the UI can filter on several repos at once.
    const repos = (Array.isArray(req.query.repo) ? req.query.repo : [req.query.repo])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value !== '');
    const statusParam = typeof req.query.status === 'string' ? req.query.status : '';

    let statuses: Status[] | undefined;
    if (statusParam === '' || statusParam === 'active') {
      statuses = ACTIVE_STATUSES;
    } else if (statusParam === 'all') {
      statuses = undefined;
    } else if (isStatus(statusParam)) {
      statuses = [statusParam];
    } else {
      return badRequest(res, `Unknown status: ${statusParam}`);
    }

    res.json(store.listTodos({ repos, statuses }));
  });

  router.post('/todos', (req, res) => {
    const { repos, title, description } = req.body ?? {};
    const nextRepos = parseRepos(repos);
    if (!nextRepos || nextRepos.length === 0) {
      return badRequest(res, 'repos must be a non-empty array of names');
    }
    if (typeof title !== 'string' || title.trim() === '') return badRequest(res, 'title is required');
    if (description !== undefined && typeof description !== 'string') {
      return badRequest(res, 'description must be a string');
    }

    const todo = store.createTodo({
      repos: nextRepos,
      title: title.trim(),
      description: description ?? '',
    });
    res.status(201).json(todo);
  });

  router.patch('/todos/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.getTodo(id)) return notFound(res);

    const { repos, title, description, status } = req.body ?? {};

    let nextRepos: string[] | undefined;
    if (repos !== undefined) {
      const parsed = parseRepos(repos);
      if (!parsed) return badRequest(res, 'repos must be an array of names');
      if (parsed.length === 0) return badRequest(res, 'repos cannot be empty');
      nextRepos = parsed;
    }

    const nextTitle = optionalText(title);
    if (nextTitle === null) return badRequest(res, 'title must be a string');
    if (nextTitle !== undefined && nextTitle.trim() === '') {
      return badRequest(res, 'title cannot be empty');
    }

    const nextDescription = optionalText(description);
    if (nextDescription === null) return badRequest(res, 'description must be a string');

    if (status !== undefined && !isStatus(status)) return badRequest(res, `Unknown status: ${status}`);

    res.json(
      store.updateTodo(id, {
        repos: nextRepos,
        title: nextTitle?.trim(),
        description: nextDescription,
        status: status as Status | undefined,
      }),
    );
  });

  router.delete('/todos/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.deleteTodo(id)) return notFound(res);
    res.status(204).end();
  });

  router.get('/todos/:id/comments', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.getTodo(id)) return notFound(res);
    res.json(store.listComments(id));
  });

  router.post('/todos/:id/comments', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;

    const { body } = req.body ?? {};
    if (typeof body !== 'string' || body.trim() === '') return badRequest(res, 'body is required');

    const comment = store.addComment(id, body.trim());
    if (!comment) return notFound(res);
    res.status(201).json(comment);
  });

  router.patch('/comments/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;

    const { body } = req.body ?? {};
    if (typeof body !== 'string' || body.trim() === '') return badRequest(res, 'body is required');

    const comment = store.updateComment(id, body.trim());
    if (!comment) return notFound(res);
    res.json(comment);
  });

  router.delete('/comments/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.deleteComment(id)) return notFound(res);
    res.status(204).end();
  });

  router.get('/repos', (_req, res) => {
    res.json(store.listRepos());
  });

  return router;
}
