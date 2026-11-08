import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';

import { authMiddleware, login, logout, register } from './auth.js';
import { isCommand, runCommand, HELP_TEXT } from './commands.js';
import { db } from './db.js';
import { addDocument, deleteDocument, getDocument, listDocuments, updateDocument } from './ingest.js';
import { retrieve, searchOnly } from './retrieve.js';
import { chatCompletion, getLlmConfig, llmConfigured, saveLlmConfig } from './llm.js';
import { fetchUrl } from './urlfetch.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- 认证 ----------
app.post('/api/auth/register', (req, res) => {
  try {
    res.json(register(req.body?.username, req.body?.password));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    res.json(login(req.body?.username, req.body?.password));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.use('/api', authMiddleware);

app.post('/api/auth/logout', (req, res) => {
  logout(req.token);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = db.prepare('SELECT id, username FROM users WHERE id=?').get(req.userId);
  res.json(user);
});

// ---------- 模型设置 ----------
app.get('/api/settings', (req, res) => {
  const cfg = getLlmConfig(req.userId);
  const envCfg = getLlmConfig(null);
  res.json({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: llmConfigured(cfg),
    maskedKey: cfg.apiKey ? cfg.apiKey.slice(0, 4) + '****' + cfg.apiKey.slice(-4) : '',
    envFallback: llmConfigured(envCfg)
  });
});

app.put('/api/settings', (req, res) => {
  const body = { ...req.body };
  if (!body.apiKey) {
    const cur = db.prepare('SELECT api_key FROM user_settings WHERE user_id=?').get(req.userId);
    body.apiKey = cur?.api_key || '';
  }
  saveLlmConfig(req.userId, body);
  res.json({ ok: true });
});

// ---------- 会话 ----------
app.get('/api/conversations', (req, res) => {
  res.json(
    db
      .prepare('SELECT id, title, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC')
      .all(req.userId)
  );
});

app.post('/api/conversations', (req, res) => {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO conversations(user_id, title) VALUES (?,?)')
    .run(req.userId, (req.body?.title || '新会话').slice(0, 60));
  res.json({ id: lastInsertRowid });
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = db
    .prepare('SELECT * FROM conversations WHERE id=? AND user_id=?')
    .get(req.params.id, req.userId);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  conv.messages = db
    .prepare('SELECT role, content, evidence, created_at FROM messages WHERE conversation_id=? ORDER BY id')
    .all(conv.id)
    .map((m) => ({ ...m, evidence: m.evidence ? JSON.parse(m.evidence) : null }));
  res.json(conv);
});

app.put('/api/conversations/:id', (req, res) => {
  const r = db
    .prepare("UPDATE conversations SET title=? WHERE id=? AND user_id=?")
    .run((req.body?.title || '新会话').slice(0, 60), req.params.id, req.userId);
  res.json({ ok: r.changes > 0 });
});

app.delete('/api/conversations/:id', (req, res) => {
  const r = db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ ok: r.changes > 0 });
});

// ---------- 知识库 ----------
app.get('/api/documents', (req, res) => res.json(listDocuments(req.userId)));

app.get('/api/documents/:id', (req, res) => {
  const doc = getDocument(Number(req.params.id), req.userId);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json(doc);
});

app.post('/api/documents', async (req, res) => {
  try {
    const { type = 'text', title, content, url, filename } = req.body || {};
    if (type === 'url') {
      if (!url) return res.status(400).json({ error: '缺少 url' });
      const page = await fetchUrl(url);
      return res.json(addDocument({ title: page.title, sourceType: 'url', sourceRef: url, content: page.text, ownerId: req.userId }));
    }
    if (!content?.trim()) return res.status(400).json({ error: '内容为空' });
    res.json(
      addDocument({
        title: title || filename || content.slice(0, 30),
        sourceType: type === 'file' ? 'file' : 'text',
        sourceRef: filename || null,
        content,
        ownerId: req.userId
      })
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/documents/:id', (req, res) => {
  try {
    const doc = updateDocument(Number(req.params.id), req.body || {}, req.userId);
    if (!doc) return res.status(404).json({ error: '文档不存在' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  const ok = deleteDocument(Number(req.params.id), req.userId);
  if (!ok) return res.status(404).json({ error: '文档不存在' });
  res.json({ ok: true });
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少查询词 q' });
  res.json(searchOnly(q, 8, req.userId));
});

// ---------- 对话 ----------
app.post('/api/chat', async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: '消息为空' });

  let convId = conversationId;
  if (!convId) {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO conversations(user_id, title) VALUES (?,?)')
      .run(req.userId, message.trim().slice(0, 30));
    convId = lastInsertRowid;
  } else {
    const owned = db
      .prepare('SELECT id FROM conversations WHERE id=? AND user_id=?')
      .get(convId, req.userId);
    if (!owned) return res.status(404).json({ error: '会话不存在' });
  }

  const history = db
    .prepare('SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 10')
    .all(convId)
    .reverse();

  db.prepare('INSERT INTO messages(conversation_id, role, content) VALUES (?,?,?)').run(convId, 'user', message);

  let type = 'chat';
  let reply;
  let evidence = [];
  try {
    if (isCommand(message)) {
      type = 'command';
      const result = await runCommand(message, req.userId);
      reply = result.reply;
    } else {
      const cfg = getLlmConfig(req.userId);
      if (!llmConfigured(cfg)) {
        reply = `尚未配置模型密钥。请点击左下角「设置」填写 API Key（支持 OpenAI 兼容协议与 Anthropic 协议），或在服务端 .env 中配置 LLM_API_KEY。\n\n当前仍可使用指令功能：\n${HELP_TEXT}`;
      } else {
        evidence = await retrieve(message, cfg, req.userId);
        const context = evidence.length
          ? evidence.map((e, i) => `[证据${i + 1}]（文档#${e.docId}《${e.title}》片段${e.seq + 1}）\n${e.text}`).join('\n\n')
          : '（知识库中没有检索到相关内容）';
        const messages = [
          {
            role: 'system',
            content:
              '你是一个知识库聊天机器人。优先基于给出的证据回答问题，并在引用处标注证据编号，如 [证据1]。' +
              '如果证据不足以回答，明确说明知识库中缺少相关内容，再谨慎补充通用知识并标注其为非知识库内容。' +
              '回答使用中文。\n\n=== 检索到的证据（SAG2: BM25 多跳 + JEV 验证）===\n' + context
          },
          ...history,
          { role: 'user', content: message }
        ];
        reply = await chatCompletion(messages, { temperature: 0.4 }, cfg);
      }
    }
  } catch (err) {
    db.prepare("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=?").run(convId);
    return res.status(500).json({ error: err.message, conversationId: convId });
  }

  db.prepare('INSERT INTO messages(conversation_id, role, content, evidence) VALUES (?,?,?,?)').run(
    convId,
    'assistant',
    reply,
    evidence.length ? JSON.stringify(evidence) : null
  );
  db.prepare("UPDATE conversations SET updated_at=datetime('now','localtime') WHERE id=?").run(convId);

  res.json({ type, reply, evidence, conversationId: convId });
});

// ---------- 前端静态资源（生产模式） ----------
const distDir = path.resolve('web/dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`kb-chatbot 服务已启动: http://localhost:${PORT}`);
});
