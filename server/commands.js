import { addDocument, deleteDocument, listDocuments, updateDocument } from './ingest.js';
import { searchOnly } from './retrieve.js';
import { fetchUrl } from './urlfetch.js';
import { logger } from './logger.js';

export const HELP_TEXT = `可用指令（在聊天框输入，也可点击输入框上方工具栏）：

- /添加知识库 <内容>            把文本加入知识库
- /添加知识库 url:<网址>        抓取网页正文加入知识库
- /更新知识库 <文档ID>|<新内容>  整篇替换指定文档
- /删除知识库 <文档ID>          删除指定文档及其全部片段
- /查询知识库 <关键词>          直接检索并展示匹配片段（不生成回答）
- /知识库列表                   查看全部文档
- /帮助                        显示本帮助

不以 / 开头的消息将走 SAG2 检索（BM25 多跳 + JEV 验证）后由模型基于知识库回答。`;

function isUrlBody(body) {
  return /^url:\s*https?:\/\/\S+/i.test(body) || /^https?:\/\/\S+$/i.test(body);
}

async function cmdAdd(body, userId) {
  if (!body) return { reply: '用法：/添加知识库 <内容> 或 /添加知识库 url:<网址>' };
  if (isUrlBody(body)) {
    const url = body.replace(/^url:\s*/i, '').trim();
    const { title, text } = await fetchUrl(url);
    const doc = addDocument({ title, sourceType: 'url', sourceRef: url, content: text, ownerId: userId });
    return { reply: `已抓取网页并入库\n- 标题：${title}\n- 文档ID：${doc.id}\n- 片段数：${doc.chunkCount}\n- 字数：${text.length}` };
  }
  const sep = body.indexOf('|');
  const title = sep > 0 ? body.slice(0, sep).trim() : body.slice(0, 30).trim();
  const content = sep > 0 ? body.slice(sep + 1) : body;
  const doc = addDocument({ title, sourceType: 'text', sourceRef: null, content, ownerId: userId });
  return { reply: `已入库。文档ID：${doc.id}，标题：${title}，片段数：${doc.chunkCount}` };
}

function cmdUpdate(body, userId) {
  const sep = body?.indexOf('|');
  if (!sep || sep <= 0) return { reply: '用法：/更新知识库 <文档ID>|<新内容>' };
  const id = Number(body.slice(0, sep).trim());
  if (!Number.isInteger(id)) return { reply: '文档ID必须是数字，用法：/更新知识库 <文档ID>|<新内容>' };
  const doc = updateDocument(id, { content: body.slice(sep + 1) }, userId);
  if (!doc) return { reply: `未找到文档 #${id}，可用 /知识库列表 查看` };
  return { reply: `已更新文档 #${doc.id}（${doc.title}），新片段数：${doc.chunkCount}` };
}

function cmdDelete(body, userId) {
  const id = Number(body?.trim());
  if (!Number.isInteger(id)) return { reply: '用法：/删除知识库 <文档ID>' };
  const ok = deleteDocument(id, userId);
  return { reply: ok ? `已删除文档 #${id} 及其全部片段` : `未找到文档 #${id}` };
}

function cmdList(userId) {
  const docs = listDocuments(userId);
  if (!docs.length) return { reply: '知识库为空。点击输入框上方的「文件 / 链接 / 文本」按钮添加知识。' };
  const lines = docs.map(
    (d) => `#${d.id} [${d.source_type}] ${d.title}（${d.chunk_count} 片段，更新于 ${d.updated_at}）`
  );
  return { reply: `知识库共 ${docs.length} 篇文档：\n${lines.join('\n')}`, docs };
}

function cmdSearch(body, userId) {
  if (!body) return { reply: '用法：/查询知识库 <关键词>' };
  const hits = searchOnly(body, 8, userId);
  if (!hits.length) return { reply: `知识库中未检索到与「${body}」相关的内容` };
  const lines = hits
    .slice(0, 5)
    .map((h, i) => `${i + 1}. [文档#${h.docId} ${h.title} · 片段${h.seq + 1}]\n${h.text.slice(0, 200)}…`);
  return { reply: `检索到 ${hits.length} 条匹配，展示前 ${Math.min(5, hits.length)} 条：\n\n${lines.join('\n\n')}`, hits };
}

const ALIASES = {
  添加知识库: 'add', 新增知识库: 'add', 导入知识库: 'add', 上传知识库: 'add', add: 'add',
  更新知识库: 'update', 修改知识库: 'update', update: 'update',
  删除知识库: 'delete', 移除知识库: 'delete', delete: 'delete',
  知识库列表: 'list', 知识列表: 'list', list: 'list', ls: 'list',
  查询知识库: 'search', 搜索知识库: 'search', 检索知识库: 'search', search: 'search',
  帮助: 'help', help: 'help'
};

export function isCommand(message) {
  return /^\s*\//.test(message);
}

export async function runCommand(message, userId) {
  const text = message.trim();
  const spaceIdx = text.search(/\s/);
  const rawName = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).replace(/^\//, '');
  const body = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
  const action = ALIASES[rawName];
  logger.info('command', `run /${rawName}`, { userId, action: action || 'unknown', bodyLen: body.length });
  if (!action) return { reply: `未知指令 /${rawName}。输入 /帮助 查看全部指令。` };
  try {
    switch (action) {
      case 'add': return await cmdAdd(body, userId);
      case 'update': return cmdUpdate(body, userId);
      case 'delete': return cmdDelete(body, userId);
      case 'list': return cmdList(userId);
      case 'search': return cmdSearch(body, userId);
      case 'help': return { reply: HELP_TEXT };
    }
  } catch (err) {
    logger.error('command', `run /${rawName} failed`, { userId, error: err.message });
    return { reply: `指令执行失败：${err.message}` };
  }
}
