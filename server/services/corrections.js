import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { userMeta } from '../lib/userMeta.js';
import { getRecentEvidence } from './conversations.js';
import { getChunk, replaceInChunk, updateChunk } from './ingest.js';
import { chatCompletion, getLlmConfig, llmConfigured } from './llm.js';

function escapeLike(value) {
  return value.replace(/[\\%_]/g, '\\$&');
}

// 用子串精确匹配定位片段，避免 BM25 分词把 URL/代码片段拆散
export function locateByText(value, ownerId, limit = 10) {
  const needle = (value || '').trim();
  if (!needle) return [];
  return db
    .prepare(
      `SELECT c.doc_id AS docId, c.seq, c.text, d.title
       FROM chunks c JOIN documents d ON d.id=c.doc_id
       WHERE d.owner_id=? AND c.text LIKE ? ESCAPE '\\'
       ORDER BY d.updated_at DESC, c.doc_id, c.seq
       LIMIT ?`
    )
    .all(ownerId, `%${escapeLike(needle)}%`, limit);
}

export function replaceAt(docId, seq, oldValue, newValue, ownerId) {
  const result = replaceInChunk(docId, seq, oldValue, newValue, ownerId);
  logger.info('kb', 'chunk replace result', {
    ...userMeta(ownerId),
    docId,
    seq,
    status: result.status,
    occurrences: result.occurrences ?? 0
  });
  return result;
}

export function replaceAcross(oldValue, newValue, ownerId) {
  const oldText = (oldValue || '').trim();
  const newText = (newValue || '').trim();
  if (!oldText || !newText) return { status: 'invalid' };
  if (oldText === newText) return { status: 'no_change' };
  const candidates = locateByText(oldText, ownerId);
  if (!candidates.length) return { status: 'not_found', oldValue: oldText };
  if (candidates.length > 1) return { status: 'ambiguous', oldValue: oldText, candidates };
  const target = candidates[0];
  return replaceAt(target.docId, target.seq, oldText, newText, ownerId);
}

function parseJson(raw) {
  return JSON.parse(String(raw).replace(/```(?:json)?|```/g, '').trim());
}

// 基于本会话最近一次回答引用的片段做精准改写；模型只允许改目标片段
export async function correctByContext(instruction, ownerId, conversationId) {
  const note = (instruction || '').trim();
  if (!note) return { status: 'invalid' };
  if (!conversationId) return { status: 'no_context' };

  const evidence = getRecentEvidence(conversationId);
  if (!evidence.length) return { status: 'no_context' };

  const candidates = [];
  for (const e of evidence) {
    if (!Number.isInteger(e.docId) || !Number.isInteger(e.seq)) continue;
    const chunk = getChunk(e.docId, e.seq, ownerId);
    if (chunk && chunk.text.trim() === String(e.text || '').trim()) candidates.push(chunk);
  }
  if (!candidates.length) return { status: 'stale', referenced: evidence.length };

  const cfg = getLlmConfig(ownerId);
  if (!llmConfigured(cfg)) return { status: 'no_llm', candidates: candidates.length };

  const listing = candidates
    .map((c, i) => `【片段${i + 1}】文档#${c.docId}《${c.title}》片段${c.seq + 1}\n${c.text}`)
    .join('\n\n');
  const prompt = [
    {
      role: 'system',
      content:
        '你是知识库片段修正器。根据用户的修改要求，选择最需要修改的一个片段，并输出修改后的完整片段文本。' +
        '只改与要求相关的内容，其余文字、语气、事实保持不变；不要添加解释或 Markdown。' +
        '只输出 JSON：{"id":片段编号,"text":"修改后的完整片段"}'
    },
    { role: 'user', content: `修改要求：${note}\n\n候选片段：\n${listing}` }
  ];

  let parsed;
  try {
    parsed = parseJson(await chatCompletion(prompt, { json: true, temperature: 0, userId: ownerId }, cfg));
  } catch (err) {
    logger.warn('kb', 'context correct llm failed', { ...userMeta(ownerId), error: err.message });
    return { status: 'llm_failed', error: err.message };
  }

  const target = candidates[(Number(parsed.id) || 1) - 1] || candidates[0];
  const next = typeof parsed.text === 'string' ? parsed.text.trim() : '';
  if (!next) return { status: 'no_change' };
  if (next === target.text.trim()) return { status: 'no_change' };
  if (next.length < target.text.trim().length * 0.3) return { status: 'too_short' };

  const updated = updateChunk(target.docId, target.seq, next, ownerId);
  logger.info('kb', 'chunk corrected from context', {
    ...userMeta(ownerId),
    conversationId,
    docId: target.docId,
    seq: target.seq
  });
  return { status: 'ok', ...updated };
}
