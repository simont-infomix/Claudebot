import { homedir } from 'node:os';
import { join } from 'node:path';

/** Loopback only: this is a single-user, single-machine tool with no auth. */
export const HOST = '127.0.0.1';

export const PORT = Number(process.env.TODO_MCP_PORT ?? 4321);

export const DB_PATH = process.env.TODO_MCP_DB ?? join(homedir(), '.todo-mcp', 'todos.db');

/** Where the built SPA lives, relative to dist/ */
export const WEB_DIR = 'web';

export const ALLOWED_HOSTS = [`${HOST}:${PORT}`, `localhost:${PORT}`];
