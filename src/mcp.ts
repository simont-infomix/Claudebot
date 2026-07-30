import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ACTIVE_STATUSES, STATUSES, type Status, type TodoStore } from './repo.js';

const ADD_TODO_DESCRIPTION = `Park a question or task that needs a HUMAN decision, so you can keep working.

Use this when something comes up mid-task that you cannot or should not decide yourself:
architectural trade-offs, product/priority calls, business rules, anything needing the user's
judgement or knowledge you do not have. The item lands in the user's review list; they will read it
in a web UI on their own time. This is NOT your own scratch todo list, and nobody will answer you
here — after recording the item, continue with the original work.

Consider calling list_todos first to avoid filing the same thing twice.`;

const LIST_TODOS_DESCRIPTION = `List the decision items already recorded via add_todo.

Mainly useful before add_todo, to check whether the question is already on the user's list.
Returns titles and statuses only; the user's notes and decisions are not exposed here.`;

export function createMcpServer(store: TodoStore): McpServer {
  const server = new McpServer(
    { name: 'todo-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'add_todo',
    {
      title: 'Add a todo for the human',
      description: ADD_TODO_DESCRIPTION,
      inputSchema: {
        repo: z
          .string()
          .min(1)
          .describe(
            'Short name of the project this belongs to: the basename of the repository folder, ' +
              'e.g. "todo-mcp" for F:\\source\\todo-mcp. Use the same spelling every time.',
          ),
        title: z
          .string()
          .min(1)
          .describe(
            'One-line summary. Phrase it as a question when a decision is needed, ' +
              'e.g. "Rate limiting: fixed window or token bucket?".',
          ),
        description: z
          .string()
          .optional()
          .describe(
            'Context for the human: why it came up, which options exist with their trade-offs, ' +
              'and which files/areas it affects. Markdown is rendered.',
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ repo, title, description }) => {
      const todo = store.createTodo({
        repo: repo.trim(),
        title: title.trim(),
        description: description ?? '',
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Recorded todo #${todo.id} for the user (repo: ${todo.repo}, status: open): ${todo.title}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'list_todos',
    {
      title: 'List recorded todos',
      description: LIST_TODOS_DESCRIPTION,
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe('Limit to one project (same short name used in add_todo). Omit for all.'),
        status: z
          .enum([...STATUSES, 'all'])
          .optional()
          .describe('Defaults to open + in_progress. Use "all" to include closed items.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, status }) => {
      const statuses: Status[] | undefined =
        status === undefined ? ACTIVE_STATUSES : status === 'all' ? undefined : [status];
      const trimmedRepo = repo?.trim();
      const todos = store.listTodos({ repos: trimmedRepo ? [trimmedRepo] : [], statuses });

      const text = todos.length
        ? todos.map((t) => `#${t.id} [${t.status}] (${t.repo}) ${t.title}`).join('\n')
        : 'No matching todos.';

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  return server;
}
