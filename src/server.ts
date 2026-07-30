import express, { type NextFunction, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { join, sep } from 'node:path';
import { ALLOWED_HOSTS, DB_PATH, HOST, PORT, WEB_DIR } from './config.js';
import { openDb } from './db.js';
import { TodoStore } from './repo.js';
import { createMcpServer } from './mcp.js';
import { createApiRouter } from './api.js';

const db = openDb();
const store = new TodoStore(db);

const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * We only ever bind to loopback, but a stray DNS-rebinding request from a browser would still
 * arrive with a foreign Host header. Reject those instead of using the SDK's deprecated option.
 */
function guardHost(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host;
  if (!host || !ALLOWED_HOSTS.includes(host)) {
    res.status(403).json({ error: 'Forbidden host' });
    return;
  }
  next();
}

app.use('/mcp', guardHost);

// Stateless MCP: a fresh server + transport per request, no session state to keep.
app.post('/mcp', async (req, res) => {
  const server = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp] request failed:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

// No server-initiated messages in stateless mode, so the SSE/terminate endpoints are unused.
app.all('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: DB_PATH });
});

app.use('/api', createApiRouter(store));

const webRoot = join(import.meta.dirname, WEB_DIR);
const indexHtml = join(webRoot, 'index.html');

/**
 * Vite fingerprints everything under /assets, so those may be cached forever. Whatever keeps its URL
 * across builds — the shell, the service worker, the manifest, the icons — must be revalidated, or
 * an installed app could get stuck on an old build.
 */
app.use(
  express.static(webRoot, {
    setHeaders(res, filePath) {
      const fingerprinted = filePath.includes(`${sep}assets${sep}`);
      res.setHeader(
        'Cache-Control',
        fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
      );
    },
  }),
);

app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api') || req.path === '/mcp') return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(indexHtml, (error) => {
    if (error) {
      res
        .status(500)
        .type('text/plain')
        .send('UI is not built yet. Run: npm run build');
    }
  });
});

app.listen(PORT, HOST, () => {
  console.log(`todo-mcp listening on http://${HOST}:${PORT}`);
  console.log(`  MCP endpoint: http://${HOST}:${PORT}/mcp`);
  console.log(`  database:     ${DB_PATH}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
