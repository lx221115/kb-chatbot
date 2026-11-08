import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { splitChunks } from '../lib/chunking.js';
import { contentTokens } from '../lib/tokenizer.js';
import { getUsername } from '../lib/userMeta.js';

const MAX_CHUNK_CHARS = 2000;

// 主线程入库与解析 worker 共用：分块文本 → { text, tokens } 行
export function toChunkRows(textChunks) {
  return textChunks.map((text) => ({ text, tokens: contentTokens(text).join(' ') }));
}

function insertChunks(docId, chunks) {
  const insChunk = db.prepare('INSERT INTO chunks(doc_id, seq, text) VALUES (?,?,?)');
  const insFts = db.prepare('INSERT INTO chunks_fts(chunk_id, tokens) VALUES (?,?)');
  chunks.forEach(({ text, tokens }, i) => {
    const { lastInsertRowid } = insChunk.run(docId, i, text);
    insFts.run(lastInsertRowid, tokens);
  });
}

// chunks 由解析 worker 产出（已分块并分词），主线程只做落库
export function addDocumentFromChunks({ title, sourceType, sourceRef, chunks, ownerId }) {
  if (!chunks.length) throw new Error('内容为空，无法入库');
  const tx = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO documents(title, source_type, source_ref, owner_id) VALUES (?,?,?,?)')
      .run(title.slice(0, 200), sourceType, sourceRef || null, ownerId);
    insertChunks(lastInsertRowid, chunks);
    return lastInsertRowid;
  });
  const id = tx();
  logger.info('kb', 'document added', { id, ownerId, username: getUsername(ownerId), sourceType, chunks: chunks.length, title: title.slice(0, 60) });
  return { id, title, chunkCount: chunks.length };
}

export function addDocument({ title, sourceType, sourceRef, content, ownerId }) {
  return addDocumentFromChunks({
    title,
    sourceType,
    sourceRef,
    ownerId,
    chunks: toChunkRows(splitChunks(content))
  });
}

export function updateDocument(id, { title, content }, ownerId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND owner_id=?').get(id, ownerId);
  if (!doc) return null;
  if (content == null) {
    if (title != null) {
      db.prepare("UPDATE documents SET title=?, updated_at=datetime('now','localtime') WHERE id=?").run(
        title.slice(0, 200),
        id
      );
    }
    const { chunkCount } = db.prepare('SELECT COUNT(*) AS chunkCount FROM chunks WHERE doc_id=?').get(id);
    logger.info('kb', 'document renamed', { id, ownerId, username: getUsername(ownerId), title: (title ?? doc.title).slice(0, 60) });
    return { id, title: title ?? doc.title, chunkCount };
  }
  const chunks = splitChunks(content);
  if (!chunks.length) throw new Error('内容为空，无法更新');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id=?)').run(id);
    db.prepare('DELETE FROM chunks WHERE doc_id=?').run(id);
    db.prepare("UPDATE documents SET title=?, updated_at=datetime('now','localtime') WHERE id=?").run(
      (title ?? doc.title).slice(0, 200),
      id
    );
    insertChunks(id, toChunkRows(chunks));
  });
  tx();
  logger.info('kb', 'document reindexed', { id, ownerId, username: getUsername(ownerId), chunks: chunks.length });
  return { id, title: title ?? doc.title, chunkCount: chunks.length };
}

function reindexChunk(chunkId, text) {
  db.prepare('DELETE FROM chunks_fts WHERE chunk_id=?').run(chunkId);
  db.prepare('INSERT INTO chunks_fts(chunk_id, tokens) VALUES (?,?)').run(chunkId, contentTokens(text).join(' '));
}

// seq 从 0 开始（内部存储），对外统一按 1-based 片段序号展示
export function getChunk(docId, seq, ownerId) {
  return (
    db
      .prepare(
        `SELECT c.id AS chunkId, c.doc_id AS docId, c.seq, c.text, d.title
         FROM chunks c JOIN documents d ON d.id=c.doc_id
         WHERE c.doc_id=? AND c.seq=? AND d.owner_id=?`
      )
      .get(docId, seq, ownerId) ?? null
  );
}

export function updateChunk(docId, seq, text, ownerId) {
  const chunk = getChunk(docId, seq, ownerId);
  if (!chunk) return null;
  if (typeof text !== 'string') throw Object.assign(new Error('片段内容必须是字符串'), { status: 400 });
  const next = text.trim();
  if (!next) throw Object.assign(new Error('片段内容不能为空'), { status: 400 });
  if (next.length > MAX_CHUNK_CHARS) {
    throw Object.assign(new Error(`片段内容过长（上限 ${MAX_CHUNK_CHARS} 字）`), { status: 400 });
  }
  if (next === chunk.text) {
    return { docId, seq, title: chunk.title, oldText: chunk.text, text: next, changed: false };
  }
  db.transaction(() => {
    db.prepare('UPDATE chunks SET text=? WHERE id=?').run(next, chunk.chunkId);
    reindexChunk(chunk.chunkId, next);
    db.prepare("UPDATE documents SET updated_at=datetime('now','localtime') WHERE id=?").run(docId);
  })();
  logger.info('kb', 'chunk updated', {
    docId,
    seq,
    ownerId,
    username: getUsername(ownerId),
    chars: next.length
  });
  return { docId, seq, title: chunk.title, oldText: chunk.text, text: next, changed: true };
}

export function replaceInChunk(docId, seq, oldValue, newValue, ownerId) {
  const chunk = getChunk(docId, seq, ownerId);
  if (!chunk) return { status: 'not_found' };
  if (!oldValue || !chunk.text.includes(oldValue)) return { status: 'value_missing', chunk };
  if (oldValue === newValue) return { status: 'no_change', chunk };
  const occurrences = chunk.text.split(oldValue).length - 1;
  const updated = updateChunk(docId, seq, chunk.text.split(oldValue).join(newValue), ownerId);
  logger.info('kb', 'chunk text replaced', {
    docId,
    seq,
    ownerId,
    username: getUsername(ownerId),
    occurrences
  });
  return { status: 'ok', occurrences, ...updated };
}

export function deleteDocument(id, ownerId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id=?)').run(id);
    db.prepare('DELETE FROM chunks WHERE doc_id=?').run(id);
    return db.prepare('DELETE FROM documents WHERE id=? AND owner_id=?').run(id, ownerId).changes;
  });
  const changes = tx();
  logger.info('kb', 'document deleted', { id, ownerId, username: getUsername(ownerId), deleted: changes > 0 });
  return changes > 0;
}

export function listDocuments(ownerId) {
  return db
    .prepare(
      `SELECT d.id, d.title, d.source_type, d.source_ref, d.created_at, d.updated_at,
              COUNT(c.id) AS chunk_count
       FROM documents d LEFT JOIN chunks c ON c.doc_id=d.id
       WHERE d.owner_id=?
       GROUP BY d.id ORDER BY d.updated_at DESC`
    )
    .all(ownerId);
}

export function getDocument(id, ownerId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND owner_id=?').get(id, ownerId);
  if (!doc) return null;
  doc.chunks = db
    .prepare('SELECT seq, text FROM chunks WHERE doc_id=? ORDER BY seq')
    .all(id)
    .map((r) => r.text);
  return doc;
}
