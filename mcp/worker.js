// Облачный MCP-сервер (Cloudflare Worker) — для коннектора в claude.ai / мобильном Claude.
// URL коннектора: https://<worker>.workers.dev/mcp/<MCP_SECRET>
// MCP_SECRET задаётся через `npx wrangler secret put MCP_SECRET` и работает как пароль.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from './src/tools.js';
import * as store from './src/store.js';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/mcp\/([^/]+)\/?$/);
    if (!env.MCP_SECRET || env.MCP_SECRET.length < 16) {
      return new Response('MCP_SECRET is not configured', { status: 500 });
    }
    if (!m || !safeEqual(m[1], env.MCP_SECRET)) {
      return new Response('Not found', { status: 404 });
    }
    // Stateless: новый сервер на каждый запрос, ответы JSON (без SSE-сессий).
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(store);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
