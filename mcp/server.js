#!/usr/bin/env node
// Локальный MCP-сервер (stdio) — для Claude Code / Claude Desktop.
// Облачная версия для коннектора claude.ai — worker.js.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './src/tools.js';
import * as store from './src/store.js';

await createServer(store).connect(new StdioServerTransport());
console.error('hexa-dashboard MCP server running');
