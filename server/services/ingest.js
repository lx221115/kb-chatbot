import { db } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { contentTokens } from '../lib/tokenizer.js';
import { getUsername } from '../lib/userMeta.js';

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 60;

export function splitChunks(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 1 > CHUNK_SIZE) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP));
    }
    buf = buf ? buf + '\n' + p : p;
    while (buf.length > CHUNK_SIZE * 2) {
      chunks.push(buf.slice(0, CHUNK_SIZE).trim());
      buf = buf.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

function insertChunks(docId, chunks) {
  const insChunk = db.prepare('INSERT INTO chunks(doc_id, seq, text) VALUES (?,?,?)');
  const insFts = db.prepare('INSERT INTO chunks_fts(chunk_id, tokens) VALUES (?,?)');
  chunks.forEach((text, i) => {
    const { lastInsertRowid } = insChunk.run(docId, i, text);
    insFts.run(lastInsertRowid, contentTokens(text).join(' '));
  });
}

export function addDocument({ title, sourceType, sourceRef, content, ownerId }) {
  const chunks = splitChunks(content);
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
    insertChunks(id, chunks);
  });
  tx();
  logger.info('kb', 'document reindexed', { id, ownerId, username: getUsername(ownerId), chunks: chunks.length });
  return { id, title: title ?? doc.title, chunkCount: chunks.length };
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
