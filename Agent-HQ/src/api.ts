import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  ACTIVE_STATUSES,
  isStatus,
  normaliseRepos,
  type Status,
  type TodoFilter,
} from './repo.js';
import type { ImportFields, Result, TodoService } from './service.js';

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

/** The `repo` / `status` / `q` query params shared by the list and its head. */
function parseTodoFilter(req: Request, res: Response): TodoFilter | undefined {
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
    badRequest(res, `Unknown status: ${statusParam}`);
    return undefined;
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  return { repos, statuses, query: query || undefined };
}

/** Hands back the value, or turns the service's own status + message into the response. */
function send<T>(res: Response, result: Result<T>): void {
  if (result.ok) res.json(result.value);
  else res.status(result.status).json({ error: result.error });
}

export function createApiRouter(service: TodoService): Router {
  const router = Router();
  const store = service.store;

  router.get('/todos', (req, res) => {
    const filter = parseTodoFilter(req, res);
    if (filter) res.json(store.listTodos(filter));
  });

  // Polled by the UI to notice todos that arrived over MCP; deliberately tiny, and never cached by
  // the service worker, so a poll can never make the list look stale.
  router.get('/todos/head', (req, res) => {
    const filter = parseTodoFilter(req, res);
    if (filter) res.json(store.headTodos(filter));
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

  router.patch('/todos/:id', async (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!store.getTodo(id)) return notFound(res);

    const { repos, title, description, status, pinned, important } = req.body ?? {};

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
    if (pinned !== undefined && typeof pinned !== 'boolean') {
      return badRequest(res, 'pinned must be a boolean');
    }
    if (important !== undefined && typeof important !== 'boolean') {
      return badRequest(res, 'important must be a boolean');
    }

    // Through the service, not the store: a status change here also has to reach the linked work
    // item. `wait: true` — the human is looking at the screen, so a failed push is worth the wait.
    const { todo } = await service.updateTodo(
      id,
      {
        repos: nextRepos,
        title: nextTitle?.trim(),
        description: nextDescription,
        status: status as Status | undefined,
        pinned: pinned as boolean | undefined,
        important: important as boolean | undefined,
      },
      { wait: true },
    );
    // The local write succeeded either way; a push failure travels back on the todo's own link.
    res.json(todo);
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

    // Everything arriving here is the human typing in the web UI; agents write over /mcp.
    const comment = store.addComment(id, body.trim(), 'user');
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

  /** Rename everywhere, or merge into an existing repo if the new name is already taken. */
  router.patch('/repos/:repo', (req, res) => {
    const from = req.params.repo;
    const { name } = req.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') return badRequest(res, 'name is required');

    if (name.trim() === from) return res.json({ updated: 0 });

    const updated = store.renameRepo(from, name.trim());
    if (updated === 0) return notFound(res);
    res.json({ updated });
  });

  /**
   * The Azure DevOps connection. The PAT is write-only across this boundary: it goes in, and only
   * `hasPat` ever comes back out — it is stored unencrypted in a database shared by every project,
   * so the least this surface can do is not hand it around.
   */
  router.get('/settings/devops', (_req, res) => {
    res.json(service.settingsView());
  });

  router.put('/settings/devops', (req, res) => {
    const { org, pat, stateInProgress, stateClosed } = req.body ?? {};
    if (typeof org !== 'string') return badRequest(res, 'org must be a string');
    if (pat !== undefined && typeof pat !== 'string') return badRequest(res, 'pat must be a string');
    if (typeof stateInProgress !== 'string' || typeof stateClosed !== 'string') {
      return badRequest(res, 'state names must be strings');
    }
    // `pat` absent keeps the stored one, so the panel can save without re-typing it.
    res.json(service.saveSettings({ org, pat, stateInProgress, stateClosed }));
  });

  // Lookups for the settings panel: the valid state names live per work item type in a project,
  // so you pick a project and a type there as a reference. Neither is stored.
  router.get('/devops/projects', async (_req, res) => {
    send(res, await service.projects());
  });

  router.get('/devops/projects/:project/types', async (req, res) => {
    send(res, await service.workItemTypes(req.params.project));
  });

  router.get('/devops/projects/:project/types/:type/states', async (req, res) => {
    send(res, await service.states(req.params.project, req.params.type));
  });

  /**
   * Attach a work item: a number or any work item URL. Reads it back, but pushes nothing.
   * `import` optionally appends the work item's description and acceptance criteria to the todo's
   * own description, which is why the answer is the whole todo rather than just the link.
   */
  router.post('/todos/:id/devops', async (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;

    const { ref, import: imports } = req.body ?? {};
    if (typeof ref !== 'string' || ref.trim() === '') return badRequest(res, 'ref is required');
    if (imports !== undefined && (typeof imports !== 'object' || imports === null)) {
      return badRequest(res, 'import must be an object');
    }

    send(
      res,
      await service.linkWorkItem(id, ref, {
        description: (imports as ImportFields | undefined)?.description === true,
        acceptance: (imports as ImportFields | undefined)?.acceptance === true,
      }),
    );
  });

  /** Drop the link. DevOps is not touched — the connection only ever existed on our side. */
  router.delete('/todos/:id/devops', (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    if (!service.unlinkWorkItem(id)) return notFound(res);
    res.status(204).end();
  });

  /** Manual retry after a failed push — there is no automatic one by design. */
  router.post('/todos/:id/devops/push', async (req, res) => {
    const id = parseId(req, res);
    if (id === undefined) return;
    send(res, await service.retryPush(id));
  });

  /*
   * Anything that escapes a handler — including a rejected promise from one of the outbound calls
   * above — must still leave here as JSON. Express's default handler renders an HTML page, which
   * the web client would then fail to parse, turning a clear server-side error into a confusing
   * one on screen.
   */
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', error);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Váratlan szerverhiba.' });
  });

  return router;
}
