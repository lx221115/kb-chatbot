import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { userMeta } from '../lib/userMeta.js';
import { fetchUrl } from '../lib/urlfetch.js';
import { runChatTurn } from './chat.js';
import { replaceAcross, replaceAt } from './corrections.js';
import { addDocument, deleteDocument, getDocument, listDocuments, updateChunk, updateDocument } from './ingest.js';
import { searchOnly } from './retrieve.js';

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

// 每个请求创建一个绑定到当前登录用户的 MCP server（无状态，工具共享 Chat 服务的数据层）
export function createMcpServer(userId) {
  const user = userMeta(userId);
  const server = new McpServer({ name: 'kb-chatbot', version: '1.0.0' });

  function handler(tool, fn) {
    return async (args) => {
      const started = Date.now();
      try {
        const data = await fn(args);
        logger.info('mcp', `tool ${tool} ok`, { ...user, ms: Date.now() - started });
        return ok(data);
      } catch (err) {
        logger.warn('mcp', `tool ${tool} failed`, { ...user, ms: Date.now() - started, error: err.message });
        return { content: [{ type: 'text', text: `错误：${err.message}` }], isError: true };
      }
    };
  }

  server.tool(
    'kb_add_text',
    '向知识库添加一段文本知识（自动分块并建立 BM25 全文索引）',
    { title: z.string().describe('文档标题（可选，默认取内容前 30 字）').optional(), content: z.string().describe('知识内容全文') },
    handler('kb_add_text', ({ title, content }) =>
      addDocument({ title: title || content.slice(0, 30), sourceType: 'text', sourceRef: null, content, ownerId: userId })
    )
  );

  server.tool(
    'kb_add_url',
    '抓取一个网页 URL 的正文并加入知识库',
    { url: z.string().describe('网页地址，如 https://example.com/article') },
    handler('kb_add_url', async ({ url }) => {
      const page = await fetchUrl(url);
      return addDocument({ title: page.title, sourceType: 'url', sourceRef: url, content: page.text, ownerId: userId });
    })
  );

  server.tool(
    'kb_add_file',
    '以文件名义向知识库添加内容（内容需以字符串传入，适用于 txt/md/csv/json/log）',
    { filename: z.string().describe('文件名，如 notes.md'), content: z.string().describe('文件文本内容') },
    handler('kb_add_file', ({ filename, content }) =>
      addDocument({ title: filename, sourceType: 'file', sourceRef: filename, content, ownerId: userId })
    )
  );

  server.tool('kb_list_documents', '列出知识库中的全部文档（id、标题、来源类型、片段数）', {}, handler('kb_list_documents', () => listDocuments(userId)));

  server.tool(
    'kb_get_document',
    '读取单个文档的详情与全部分块内容',
    { id: z.number().describe('文档 id') },
    handler('kb_get_document', ({ id }) => {
      const doc = getDocument(id, userId);
      if (!doc) throw new Error('文档不存在');
      return doc;
    })
  );

  server.tool(
    'kb_update_document',
    '整篇更新知识库文档的标题或内容（传了 content 会重新分块与索引；只改局部请用 kb_update_chunk / kb_replace_text）',
    {
      id: z.number().describe('文档 id'),
      title: z.string().describe('新标题（可选）').optional(),
      content: z.string().describe('新内容全文（可选）').optional()
    },
    handler('kb_update_document', ({ id, title, content }) => {
      const doc = updateDocument(id, { title, content }, userId);
      if (!doc) throw new Error('文档不存在');
      return doc;
    })
  );

  server.tool(
    'kb_update_chunk',
    '精准更新知识库中的单个片段：保留文档分块与片段序号，仅重建该片段的全文索引，修改后立即可检索',
    {
      docId: z.number().describe('文档 id'),
      seq: z.number().int().min(1).describe('片段序号，从 1 开始（可用 kb_get_document 查看）'),
      text: z.string().describe('新的片段全文')
    },
    handler('kb_update_chunk', ({ docId, seq, text }) => {
      const updated = updateChunk(docId, seq - 1, text, userId);
      if (!updated) throw new Error('文档或片段不存在');
      return updated;
    })
  );

  server.tool(
    'kb_replace_text',
    '精准替换知识库中的旧值：提供 docId+seq 时只改该片段，否则全库定位；全库仅唯一命中时自动替换，多命中返回候选',
    {
      oldValue: z.string().describe('要替换的旧文本，需在片段中连续出现'),
      newValue: z.string().describe('替换后的新文本'),
      docId: z.number().describe('限定文档 id（可选）').optional(),
      seq: z.number().int().min(1).describe('限定片段序号，从 1 开始（可选，需与 docId 同时提供）').optional()
    },
    handler('kb_replace_text', ({ oldValue, newValue, docId, seq }) => {
      if (docId != null || seq != null) {
        if (docId == null || seq == null) throw new Error('docId 与 seq 需同时提供');
        const result = replaceAt(docId, seq - 1, oldValue, newValue, userId);
        if (result.status === 'not_found') throw new Error('文档或片段不存在');
        if (result.status === 'value_missing') throw new Error('该片段中不包含 oldValue');
        if (result.status === 'no_change') throw new Error('新旧值一致，未做修改');
        return result;
      }
      const result = replaceAcross(oldValue, newValue, userId);
      if (result.status === 'ambiguous') return result;
      if (result.status === 'not_found') throw new Error('知识库中未找到包含 oldValue 的片段');
      if (result.status === 'invalid') throw new Error('oldValue 与 newValue 不能为空');
      if (result.status === 'no_change') throw new Error('新旧值一致，未做修改');
      return result;
    })
  );

  server.tool(
    'kb_delete_document',
    '从知识库删除一个文档及其全部片段（不可恢复）',
    { id: z.number().describe('文档 id') },
    handler('kb_delete_document', ({ id }) => {
      if (!deleteDocument(id, userId)) throw new Error('文档不存在');
      return { ok: true };
    })
  );

  server.tool(
    'kb_search',
    'BM25 全文检索知识库，返回最相关的片段（含文档标题与得分）',
    { query: z.string().describe('检索关键词或问题') },
    handler('kb_search', ({ query }) => searchOnly(query, 8, userId))
  );

  server.tool(
    'kb_chat',
    '向知识库机器人提问：内部执行 SAG2 多跳检索 + JEV 证据验证 + LLM 生成回答；未配置模型时直接返回检索片段；以 / 开头的消息会被当作知识库指令执行（如 /知识库列表、/帮助）',
    {
      message: z.string().describe('问题或斜杠指令'),
      conversationId: z.number().describe('会话 id（可选，缺省则新建会话）').optional()
    },
    handler('kb_chat', ({ message, conversationId }) => {
      if (!message?.trim()) throw new Error('消息为空');
      return runChatTurn(userId, message, conversationId);
    })
  );

  return server;
}
