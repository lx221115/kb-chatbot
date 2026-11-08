#!/usr/bin/env node
// KB Chatbot 知识库 MCP 服务器（stdio）
// 通过 REST API 暴露知识库增删改查，供其他 agent（Qoder/Claude 等 MCP 客户端）调用。
// 环境变量：
//   KB_BASE_URL  后端地址，默认 http://localhost:3000
//   KB_TOKEN     Bearer token（优先）
//   KB_USERNAME / KB_PASSWORD  无 token 时自动登录换取
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE_URL = (process.env.KB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
let token = process.env.KB_TOKEN || '';

async function ensureToken() {
  if (token) return;
  const { KB_USERNAME, KB_PASSWORD } = process.env;
  if (!KB_USERNAME || !KB_PASSWORD) {
    throw new Error('未配置访问凭证：请设置环境变量 KB_TOKEN，或同时设置 KB_USERNAME 和 KB_PASSWORD');
  }
  const res = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: KB_USERNAME, password: KB_PASSWORD })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `登录失败 (HTTP ${res.status})`);
  token = data.token;
}

async function call(method, path, body) {
  await ensureToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败 (HTTP ${res.status})`);
  return data;
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function handler(fn) {
  return async (args) => {
    try {
      return ok(await fn(args));
    } catch (err) {
      return { content: [{ type: 'text', text: `错误：${err.message}` }], isError: true };
    }
  };
}

const server = new McpServer({ name: 'kb-chatbot', version: '1.0.0' });

server.tool(
  'kb_add_text',
  '向知识库添加一段文本知识（自动分块并建立 BM25 全文索引）',
  { title: z.string().describe('文档标题（可选，默认取内容前 30 字）').optional(), content: z.string().describe('知识内容全文') },
  handler(async ({ title, content }) => call('POST', '/api/documents', { type: 'text', title, content }))
);

server.tool(
  'kb_add_url',
  '抓取一个网页 URL 的正文并加入知识库',
  { url: z.string().describe('网页地址，如 https://example.com/article') },
  handler(async ({ url }) => call('POST', '/api/documents', { type: 'url', url }))
);

server.tool(
  'kb_add_file',
  '以文件名义向知识库添加内容（内容需以字符串传入，适用于 txt/md/csv/json/log）',
  {
    filename: z.string().describe('文件名，如 notes.md'),
    content: z.string().describe('文件文本内容')
  },
  handler(async ({ filename, content }) => call('POST', '/api/documents', { type: 'file', filename, content }))
);

server.tool('kb_list_documents', '列出知识库中的全部文档（id、标题、来源类型、片段数）', {}, handler(() => call('GET', '/api/documents')));

server.tool(
  'kb_get_document',
  '读取单个文档的详情与全部分块内容',
  { id: z.number().describe('文档 id') },
  handler(async ({ id }) => call('GET', `/api/documents/${id}`))
);

server.tool(
  'kb_update_document',
  '更新知识库文档的标题或内容（传了 content 会重新分块与索引）',
  {
    id: z.number().describe('文档 id'),
    title: z.string().describe('新标题（可选）').optional(),
    content: z.string().describe('新内容全文（可选）').optional()
  },
  handler(async ({ id, title, content }) => call('PUT', `/api/documents/${id}`, { title, content }))
);

server.tool(
  'kb_delete_document',
  '从知识库删除一个文档及其全部片段（不可恢复）',
  { id: z.number().describe('文档 id') },
  handler(async ({ id }) => call('DELETE', `/api/documents/${id}`))
);

server.tool(
  'kb_search',
  'BM25 全文检索知识库，返回最相关的片段（含文档标题与得分）',
  { query: z.string().describe('检索关键词或问题') },
  handler(async ({ query }) => call('GET', `/api/search?q=${encodeURIComponent(query)}`))
);

server.tool(
  'kb_chat',
  '向知识库机器人提问：内部执行 SAG2 多跳检索 + JEV 证据验证 + LLM 生成回答；以 / 开头的消息会被当作知识库指令执行（如 /知识库列表、/帮助）',
  {
    message: z.string().describe('问题或斜杠指令'),
    conversationId: z.number().describe('会话 id（可选，缺省则新建会话）').optional()
  },
  handler(async ({ message, conversationId }) => call('POST', '/api/chat', { message, conversationId }))
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[kb-mcp] 已启动，后端: ${BASE_URL}，凭证: ${process.env.KB_TOKEN ? 'KB_TOKEN' : process.env.KB_USERNAME ? 'KB_USERNAME/KB_PASSWORD' : '未配置'}`);
