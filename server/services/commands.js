import { logger } from '../lib/logger.js';
import { userMeta } from '../lib/userMeta.js';
import { fetchUrl } from '../lib/urlfetch.js';
import { correctByContext, replaceAcross, replaceAt } from './corrections.js';
import { addDocument, deleteDocument, listDocuments, updateChunk, updateDocument } from './ingest.js';
import { searchOnly } from './retrieve.js';

export const HELP_TEXT = `可用指令（在聊天框输入，也可点击输入框上方工具栏）：

- /添加知识库 <内容>            把文本加入知识库
- /添加知识库 url:<网址>        抓取网页正文加入知识库
- /查询知识库 <关键词>          直接检索并展示匹配片段（不生成回答）
- /修正知识库 <旧值> => <新值>   全库精准替换旧值（唯一命中自动修改）
- /修正知识库 <文档ID>:<片段> => <旧值> => <新值>  指定片段替换旧值
- /修正知识库 <文档ID>:<片段>|<新内容>            指定片段整段替换
- /修正知识库 <修改要求>         基于上一轮回答的引用片段，由模型精准改写
- /更新知识库 <文档ID>|<新内容>  整篇替换指定文档（会重新分块）
- /删除知识库 <文档ID>          删除指定文档及其全部片段
- /知识库列表                   查看全部文档
- /帮助                        显示本帮助

片段序号从 1 开始，/查询知识库 与回答证据中展示的片段号均可直接使用。
不以 / 开头的消息将走 SAG2 检索（BM25 多跳 + JEV 验证）后由模型基于知识库回答；未配置模型时自动降级为纯检索，直接返回命中的片段。`;

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

const CORRECT_USAGE =
  '用法：\n- /修正知识库 <旧值> => <新值>\n- /修正知识库 <文档ID>:<片段> => <旧值> => <新值>\n- /修正知识库 <文档ID>:<片段>|<新内容>\n- /修正知识库 <修改要求>（基于上一轮引用片段）';

function preview(text, max = 200) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

// 用户看到的片段序号从 1 开始，内部 seq 从 0 开始
function parseTarget(input) {
  const m = /^#?(\d+)\s*[:：]\s*(\d+)$/.exec((input || '').trim());
  if (!m) return null;
  const docId = Number(m[1]);
  const seqLabel = Number(m[2]);
  if (!Number.isInteger(docId) || seqLabel < 1) return null;
  return { docId, seq: seqLabel - 1 };
}

function correctionReply(result) {
  switch (result.status) {
    case 'ok':
      return {
        reply:
          `已修正 文档#${result.docId}《${result.title}》片段${result.seq + 1}` +
          `${result.occurrences > 0 ? `（替换 ${result.occurrences} 处）` : ''}\n` +
          `- 旧：${preview(result.oldText)}\n- 新：${preview(result.text)}`
      };
    case 'ambiguous':
      return {
        reply:
          `旧值在 ${result.candidates.length} 个片段中出现，请指定目标：\n` +
          result.candidates
            .slice(0, 5)
            .map((c, i) => `${i + 1}. 文档#${c.docId}《${c.title}》片段${c.seq + 1}：${preview(c.text, 120)}`)
            .join('\n') +
          `\n\n用法：/修正知识库 <文档ID>:<片段> => ${result.oldValue} => <新值>`
      };
    case 'not_found':
      return { reply: `知识库中未找到包含「${result.oldValue}」的片段` };
    case 'value_missing':
      return { reply: '指定片段中已不包含该旧值，可能已被修改；可先 /查询知识库 确认当前内容' };
    case 'no_change':
      return { reply: '新值与当前内容一致，未做修改' };
    case 'stale':
      return {
        reply: `上一轮引用的 ${result.referenced} 个片段内容已变化，无法安全定位；请改用「旧值 => 新值」精确修正`
      };
    case 'no_context':
      return { reply: '当前会话没有可定位的引用片段。请先提问获得回答，或使用「旧值 => 新值」精确修正' };
    case 'no_llm':
      return { reply: '基于上下文的改写需要先配置模型密钥；也可使用「旧值 => 新值」精确修正' };
    case 'llm_failed':
      return { reply: `模型改写失败：${result.error}` };
    case 'too_short':
      return { reply: '模型返回的片段过短，为避免误删已拒绝写入；请改用显式语法修正' };
    case 'invalid':
      return { reply: CORRECT_USAGE };
    default:
      return { reply: `修正失败：${result.status}` };
  }
}

async function cmdCorrect(body, userId, conversationId) {
  if (!body) return { reply: CORRECT_USAGE };

  const pipe = body.indexOf('|');
  if (pipe >= 0) {
    const target = parseTarget(body.slice(0, pipe));
    if (!target) return { reply: '指定片段格式应为 <文档ID>:<片段>，例如 /修正知识库 3:2|新的完整片段内容' };
    const text = body.slice(pipe + 1).trim();
    if (!text) return { reply: '新内容不能为空' };
    const updated = updateChunk(target.docId, target.seq, text, userId);
    if (!updated) return { reply: `未找到文档 #${target.docId} 的片段 ${target.seq + 1}` };
    return correctionReply({ status: 'ok', ...updated });
  }

  const arrow = body.indexOf('=>');
  if (arrow >= 0) {
    const lhs = body.slice(0, arrow).trim();
    const rest = body.slice(arrow + 2).trim();
    const target = parseTarget(lhs);
    if (target) {
      const second = rest.indexOf('=>');
      if (second < 0) return { reply: '指定片段时用法：/修正知识库 <文档ID>:<片段> => <旧值> => <新值>' };
      const oldValue = rest.slice(0, second).trim();
      const newValue = rest.slice(second + 2).trim();
      if (!oldValue || !newValue) return { reply: '旧值和新值都不能为空' };
      return correctionReply(replaceAt(target.docId, target.seq, oldValue, newValue, userId));
    }
    if (!rest) return { reply: '新值不能为空' };
    return correctionReply(replaceAcross(lhs, rest, userId));
  }

  return correctionReply(await correctByContext(body, userId, conversationId));
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
  修正知识库: 'correct', 纠正知识库: 'correct', 更正知识库: 'correct', correct: 'correct', fix: 'correct',
  更新知识库: 'update', 修改知识库: 'update', update: 'update',
  删除知识库: 'delete', 移除知识库: 'delete', delete: 'delete',
  知识库列表: 'list', 知识列表: 'list', list: 'list', ls: 'list',
  查询知识库: 'search', 搜索知识库: 'search', 检索知识库: 'search', search: 'search',
  帮助: 'help', help: 'help'
};

export function isCommand(message) {
  return /^\s*\//.test(message);
}

export async function runCommand(message, userId, { conversationId } = {}) {
  const text = message.trim();
  const spaceIdx = text.search(/\s/);
  const rawName = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).replace(/^\//, '');
  const body = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();
  const action = ALIASES[rawName];
  logger.info('command', `run /${rawName}`, { ...userMeta(userId), action: action || 'unknown', bodyLen: body.length });
  if (!action) return { reply: `未知指令 /${rawName}。输入 /帮助 查看全部指令。` };
  try {
    switch (action) {
      case 'add': return await cmdAdd(body, userId);
      case 'correct': return await cmdCorrect(body, userId, conversationId);
      case 'update': return cmdUpdate(body, userId);
      case 'delete': return cmdDelete(body, userId);
      case 'list': return cmdList(userId);
      case 'search': return cmdSearch(body, userId);
      case 'help': return { reply: HELP_TEXT };
    }
  } catch (err) {
    logger.error('command', `run /${rawName} failed`, { ...userMeta(userId), error: err.message });
    return { reply: `指令执行失败：${err.message}` };
  }
}
