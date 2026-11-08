import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { authMiddleware } from './services/auth.js';
import { MAX_JSON_BODY_MB, MAX_UPLOAD_MB } from './lib/config.js';
import { initLogger, logger } from './lib/logger.js';
import { createMcpServer } from './services/mcpServer.js';
import { accessLog } from './middleware/accessLog.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import authRouter from './routes/auth.js';
import chatRouter from './routes/chat.js';
import conversationsRouter from './routes/conversations.js';
import documentsRouter from './routes/documents.js';
import searchRouter from './routes/search.js';
import settingsRouter from './routes/settings.js';

initLogger({ echo: true });

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(accessLog);
app.use(express.json({ limit: `${MAX_JSON_BODY_MB}mb` }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// 认证路由内部对 logout/me 单独鉴权，register/login 保持公开
app.use('/api/auth', authRouter);
// 剩余 /api 接口统一要求登录
app.use('/api', authMiddleware);

app.get('/api/config', (_req, res) => res.json({ maxUploadMB: MAX_UPLOAD_MB }));

app.use('/api/settings', settingsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/search', searchRouter);
app.use('/api/chat', chatRouter);

// MCP（Streamable HTTP，无状态）：与 Chat 服务同进程，复用 Bearer 鉴权
app.post('/api/mcp', async (req, res) => {
  const mcp = createMcpServer(req.userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    mcp.close();
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error('mcp', 'request failed', { error: err.message });
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});
app.get('/api/mcp', (_req, res) => res.status(405).json({ error: 'MCP 端点仅支持 POST' }));
app.delete('/api/mcp', (_req, res) => res.status(405).json({ error: 'MCP 端点仅支持 POST' }));

app.use('/api', apiNotFound);

// 前端静态资源（生产模式）
const distDir = path.resolve('web/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use(errorHandler);

app.listen(PORT, () => {
  logger.info('system', `kb-chatbot server listening on http://localhost:${PORT}`);
  console.log(`kb-chatbot 服务已启动: http://localhost:${PORT}`);
});
