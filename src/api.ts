import { Router, type Request, type Response } from 'express';
import { ACTIVE_STATUSES, isStatus, type Status, type TodoStore } from './repo.js';

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
    const { repo, title, description } = req.body ?? {};
    if (typeof repo !== 'string' || repo.trim() === '') return badRequest(res, 'repo is required');
    if (typeof title !== 'string' || title.trim() === '') return badRequest(res, 'title is required');
    if (description !== undefined && typeof description !== 'string') {
      return badRequest(res, 'description must be a string');
    }

    const todo = store.createTodo({
      repo: repo.trim(),
      title: title.trim(),
      description: description ?? '',
    });
    res.status(201).json(todo);
  });

  router.patch('/todos/:id', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.getTodo(id)) return notFound(res);

    const { title, description, status } = req.body ?? {};

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
