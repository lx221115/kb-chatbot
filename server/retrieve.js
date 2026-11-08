import { db } from './db.js';
import { chatCompletion, llmConfigured } from './llm.js';
import { contentTokens, orExpr, tokenize } from './tokenizer.js';

function bm25Search(matchExpr, limit, ownerId) {
  if (!matchExpr) return [];
  try {
    return db
      .prepare(
        `SELECT f.chunk_id, f.tokens, bm25(chunks_fts) AS score,
                c.text, c.doc_id, c.seq, d.title
         FROM chunks_fts f
         JOIN chunks c ON c.id = f.chunk_id
         JOIN documents d ON d.id = c.doc_id
         WHERE chunks_fts MATCH ? AND d.owner_id = ?
         ORDER BY score LIMIT ?`
      )
      .all(matchExpr, ownerId, limit);
  } catch {
    return [];
  }
}

// SAG2 的 term-to-passage：从首轮高分片段中抽取显著词项，再发起一轮检索
function extractExpansionTerms(passages, max = 8) {
  const freq = new Map();
  for (const p of passages) {
    for (const t of new Set(contentTokens(p.text))) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .filter(([t]) => t.length >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

async function jevValidate(query, candidates, cfg) {
  if (!llmConfigured(cfg) || candidates.length <= 1) return candidates.slice(0, 6);
  const listing = candidates
    .map((c, i) => `【片段${i + 1}】(来源: ${c.title})\n${c.text.slice(0, 600)}`)
    .join('\n\n');
  const prompt = [
    {
      role: 'system',
      content:
        '你是 JEV（Joint Evidence Validator，联合证据验证器）。给定用户问题和编号的候选证据片段，' +
        '结合所有片段联合判断每个片段对回答问题的证据价值。' +
        '只输出 JSON：{"results":[{"id":片段编号,"relevant":是否相关,"score":0到10的整数,"reason":"一句话理由"}]}'
    },
    { role: 'user', content: `问题：${query}\n\n候选证据：\n${listing}` }
  ];
  try {
    const raw = await chatCompletion(prompt, { json: true, temperature: 0 }, cfg);
    const parsed = JSON.parse(raw.replace(/```(?:json)?|```/g, '').trim());
    const byId = new Map((parsed.results || []).map((r) => [r.id, r]));
    const scored = candidates
      .map((c, i) => ({ ...c, jev: byId.get(i + 1) }))
      .filter((c) => !c.jev || c.jev.relevant !== false)
      .map((c) => ({ ...c, jevScore: c.jev?.score ?? 5 }))
      .filter((c) => c.jevScore >= 5)
      .sort((a, b) => b.jevScore - a.jevScore);
    return (scored.length ? scored : candidates).slice(0, 6);
  } catch {
    return candidates.slice(0, 6);
  }
}

export async function retrieve(query, cfg, ownerId) {
  const qTokens = [...new Set(tokenize(query))];
  const hop1 = bm25Search(orExpr(qTokens), 20, ownerId);

  const merged = new Map();
  for (const r of hop1) merged.set(r.chunk_id, r);

  const terms = extractExpansionTerms(hop1.slice(0, 5));
  const expansionExpr = orExpr([...terms, ...qTokens.filter((t) => t.length >= 2)]);
  if (expansionExpr) {
    for (const r of bm25Search(expansionExpr, 20, ownerId)) {
      if (!merged.has(r.chunk_id)) merged.set(r.chunk_id, r);
    }
  }

  const candidates = [...merged.values()].sort((a, b) => a.score - b.score).slice(0, 12);
  const validated = await jevValidate(query, candidates, cfg);
  return validated.map((v) => ({
    docId: v.doc_id,
    title: v.title,
    seq: v.seq,
    text: v.text,
    jevScore: v.jevScore ?? null
  }));
}

export function searchOnly(query, limit = 8, ownerId) {
  const expr = orExpr([...new Set(tokenize(query))]);
  return bm25Search(expr, limit, ownerId).map((r) => ({
    docId: r.doc_id,
    title: r.title,
    seq: r.seq,
    text: r.text,
    score: r.score
  }));
}
