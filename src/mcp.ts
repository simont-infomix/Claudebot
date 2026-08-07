import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ACTIVE_STATUSES,
  STATUSES,
  type Status,
  type Ticket,
  type TodoListItem,
  type TodoStore,
} from './repo.js';

const ADD_TODO_DESCRIPTION = `Park a question or task that needs a HUMAN decision, so you can keep working.

Use this when something comes up mid-task that you cannot or should not decide yourself:
architectural trade-offs, product/priority calls, business rules, anything needing the user's
judgement or knowledge you do not have. The item lands in the user's review list; they will read it
in a web UI on their own time. This is NOT your own scratch todo list, and nobody will answer you
here — after recording the item, continue with the original work.

Consider calling search_todos first to avoid filing the same thing twice.`;

const LIST_TODOS_DESCRIPTION = `List the decision items already recorded via add_todo.

Mainly useful before add_todo, to check whether the question is already on the user's list.
Returns titles and statuses only; the user's notes and decisions are not exposed here — read a
specific item with get_ticket when the user asks you to work on it. A trailing comment count is the
only hint that anything has been written on an item.`;

const SEARCH_TODOS_DESCRIPTION = `Find recorded items by text in their title or description.

This is add_todo hygiene: before filing something, search for the words you would put in the title
and see whether the user already has it. Once the list grows past a screenful, this beats reading
all of list_todos.

Matching is a plain case-insensitive substring — no operators, no stemming — so search one or two
distinctive words rather than a whole sentence. Same output as list_todos: no comment bodies.`;

const GET_TICKET_DESCRIPTION = `Read one recorded item in full by its number: title, description,
status, the repos it is filed under, and every comment the user has written on it.

Use it when the user points you at an item ("do #12", "what did I write on 7?"). This is a pull, not
a channel: nothing new arrives here unless the user has been in the web UI, so do not poll it and do
not wait on it after add_todo — the answer, if any, comes from the user in the chat.

Works across every project: the number alone identifies the item, no repo needed.`;

const UPDATE_TICKET_DESCRIPTION = `Report back on a recorded item: leave a note on it, and/or move
it to in_progress.

Use it once you have acted on an item the user pointed you at — say what you did, what you found, or
where it stalled. The note joins the same thread the user writes in, so the item carries its outcome
instead of just the original question.

You cannot close an item. Closing means "I am satisfied with this", which is the user's judgement and
one click for them in the web UI. Nor is this a place to ask a follow-up question: nobody is watching
this end, so ask in the chat instead.`;

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
        // trimmed before the length check: a blank name would leave the item under no repo at all
        repo: z
          .string()
          .trim()
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
        repos: [repo.trim()],
        title: title.trim(),
        description: description ?? '',
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Recorded todo #${todo.id} for the user (repo: ${repo.trim()}, status: open): ${todo.title}`,
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
          .describe(
            'Limit to one project (same short name used in add_todo). Omit for all. ' +
              'The user may have filed an item under several projects; it shows up under each.',
          ),
        status: z
          .enum([...STATUSES, 'all'])
          .optional()
          .describe('Defaults to open + in_progress. Use "all" to include closed items.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ repo, status }) => ({
      content: [{ type: 'text' as const, text: formatList(store.listTodos(listFilter(repo, status))) }],
    }),
  );

  server.registerTool(
    'search_todos',
    {
      title: 'Search recorded todos',
      description: SEARCH_TODOS_DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .trim()
          .min(1)
          .describe('Text to look for in the title or description, e.g. "rate limit".'),
        repo: z.string().optional().describe('Limit to one project. Omit to search everywhere.'),
        status: z
          .enum([...STATUSES, 'all'])
          .optional()
          .describe('Defaults to open + in_progress. Use "all" to include closed items.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, repo, status }) => ({
      content: [
        {
          type: 'text' as const,
          text: formatList(store.listTodos({ ...listFilter(repo, status), query })),
        },
      ],
    }),
  );

  server.registerTool(
    'get_ticket',
    {
      title: 'Read one recorded todo in full',
      description: GET_TICKET_DESCRIPTION,
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe('The item number as shown by list_todos or add_todo (the "#12" in "#12 [open]").'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const ticket = store.getTicket(id);
      if (!ticket) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `No todo with id #${id}.` }],
        };
      }
      return { content: [{ type: 'text' as const, text: formatTicket(ticket) }] };
    },
  );

  server.registerTool(
    'update_ticket',
    {
      title: 'Comment on a todo / mark it in progress',
      description: UPDATE_TICKET_DESCRIPTION,
      inputSchema: {
        id: z.number().int().positive().describe('The item number, as in get_ticket.'),
        comment: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(
            'What you did, found, or got stuck on. Written for the human reading the item later, ' +
              'not for yourself. Markdown is rendered.',
          ),
        // No 'closed': that is the user's verdict, not the agent's.
        status: z
          .enum(['open', 'in_progress'])
          .optional()
          .describe(
            'Set "in_progress" when you have started acting on the item, or "open" to hand it ' +
              'back untouched. Closing is the user\'s call and is not available here.',
          ),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, comment, status }) => {
      if (comment === undefined && status === undefined) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Give a comment, a status, or both.' }],
        };
      }
      if (!store.getTodo(id)) {
        return { isError: true, content: [{ type: 'text' as const, text: `No todo with id #${id}.` }] };
      }

      if (comment !== undefined) store.addComment(id, comment);
      const todo = status !== undefined ? store.updateTodo(id, { status }) : store.getTodo(id);

      const done = [comment !== undefined ? 'comment added' : '', status ? `status: ${status}` : '']
        .filter(Boolean)
        .join(', ');
      return {
        content: [{ type: 'text' as const, text: `Updated #${id} (${done}): ${todo!.title}` }],
      };
    },
  );

  return server;
}

/** The repo/status pair shared by list_todos and search_todos. */
function listFilter(repo: string | undefined, status: Status | 'all' | undefined) {
  const statuses: Status[] | undefined =
    status === undefined ? ACTIVE_STATUSES : status === 'all' ? undefined : [status];
  const trimmed = repo?.trim();
  return { repos: trimmed ? [trimmed] : [], statuses };
}

/** One line per item. The comment count is the only sign that the user has written back. */
function formatList(todos: TodoListItem[]): string {
  if (todos.length === 0) return 'No matching todos.';
  return todos
    .map((t) => {
      const comments = t.comment_count > 0 ? ` · ${t.comment_count} comment(s)` : '';
      return `#${t.id} [${t.status}] (${t.repos.join(', ')}) ${t.title}${comments}`;
    })
    .join('\n');
}

function formatTicket(ticket: Ticket): string {
  const lines = [
    `#${ticket.id} [${ticket.status}] ${ticket.title}`,
    `repos: ${ticket.repos.join(', ')}`,
    `created: ${iso(ticket.created_at)}    updated: ${iso(ticket.updated_at)}`,
    '',
    ticket.description.trim() || '(no description)',
    '',
    // The user writes here in the web UI, agents through update_ticket — one shared thread.
    ticket.comments.length
      ? `--- comments (${ticket.comments.length}) ---`
      : '--- no comments yet ---',
  ];

  for (const comment of ticket.comments) {
    lines.push('', `[${iso(comment.created_at)}]`, comment.body.trim());
  }

  return lines.join('\n');
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}
