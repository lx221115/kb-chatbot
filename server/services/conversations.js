import { db } from '../lib/db.js';

export function listConversations(userId) {
  return db
    .prepare('SELECT id, title, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC')
    .all(userId);
}

export function createConversation(userId, title) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO conversations(user_id, title) VALUES (?,?)')
    .run(userId, (title || '新会话').slice(0, 60));
  return lastInsertRowid;
}

export function getConversation(id, userId) {
  const conv = db.prepare('SELECT * FROM conversations WHERE id=? AND user_id=?').get(id, userId);
  if (!conv) return null;
  conv.messages = db
    .prepare('SELECT role, content, evidence, created_at FROM messages WHERE conversation_id=? ORDER BY id')
    .all(conv.id)
    .map((m) => ({ ...m, evidence: m.evidence ? JSON.parse(m.evidence) : null }));
  return conv;
}

export function renameConversation(id, title, userId) {
  const r = db
    .prepare('UPDATE conversations SET title=? WHERE id=? AND user_id=?')
    .run((title || '新会话').slice(0, 60), id, userId);
  return r.changes > 0;
}

export function deleteConversation(id, userId) {
  const r = db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(id, userId);
  return r.changes > 0;
}

export function conversationOwned(id, userId) {
  return Boolean(db.prepare('SELECT id FROM conversations WHERE id=? AND user_id=?').get(id, userId));
}

export function getHistory(conversationId, limit = 10) {
  return db
    .prepare('SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?')
    .all(conversationId, limit)
    .reverse();
}

export function getRecentEvidence(conversationId) {
  const row = db
    .prepare(
      `SELECT evidence FROM messages
       WHERE conversation_id=? AND role='assistant' AND evidence IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(conversationId);
  return row ? JSON.parse(row.evidence) : [];
}

export function addMessage(conversationId, role, content, evidence = null) {
  db.prepare('INSERT INTO messages(conversation_id, role, content, evidence) VALUES (?,?,?,?)').run(
    conversationId,
    role,
    content,
    evidence ? JSON.stringify(evidence) : null
  );
}

export function touchConversation(id) {
  db.prepare("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=?").run(id);
}
