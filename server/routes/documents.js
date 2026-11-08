import { Router } from 'express';
import {
  addDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  replaceInChunk,
  updateChunk,
  updateDocument
} from '../services/ingest.js';
import { asyncHandler } from '../middleware/errors.js';
import { fetchUrl } from '../lib/urlfetch.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listDocuments(req.userId));
});

router.get('/:id', (req, res) => {
  const doc = getDocument(Number(req.params.id), req.userId);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json(doc);
});

// 支持 text / file / url 三种入库方式
router.post('/', asyncHandler(async (req, res) => {
  const { type = 'text', title, content, url, filename } = req.body || {};
  if (type === 'url') {
    if (!url) return res.status(400).json({ error: '缺少 url' });
    const page = await fetchUrl(url);
    return res.json(
      addDocument({ title: page.title, sourceType: 'url', sourceRef: url, content: page.text, ownerId: req.userId })
    );
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
}));

router.put('/:id', (req, res) => {
  const doc = updateDocument(Number(req.params.id), req.body || {}, req.userId);
  if (!doc) return res.status(404).json({ error: '文档不存在' });
  res.json(doc);
});

// 片段级修正：传 text 整段替换，或传 oldValue/newValue 做子串替换
router.patch('/:id/chunks/:seq', (req, res) => {
  const docId = Number(req.params.id);
  const seqLabel = Number(req.params.seq);
  if (!Number.isInteger(docId) || !Number.isInteger(seqLabel) || seqLabel < 1) {
    return res.status(400).json({ error: '片段序号需为从 1 开始的整数' });
  }
  const seq = seqLabel - 1;
  const { text, oldValue, newValue } = req.body || {};

  if (typeof text === 'string') {
    const updated = updateChunk(docId, seq, text, req.userId);
    if (!updated) return res.status(404).json({ error: '文档或片段不存在' });
    return res.json(updated);
  }
  if (typeof oldValue === 'string' && typeof newValue === 'string') {
    const result = replaceInChunk(docId, seq, oldValue, newValue, req.userId);
    if (result.status === 'not_found') return res.status(404).json({ error: '文档或片段不存在' });
    if (result.status === 'value_missing') return res.status(409).json({ error: '该片段中不包含 oldValue' });
    if (result.status === 'no_change') return res.status(400).json({ error: '新旧值一致，未做修改' });
    return res.json(result);
  }
  return res.status(400).json({ error: '需提供 text，或 oldValue 与 newValue' });
});

router.delete('/:id', (req, res) => {
  const ok = deleteDocument(Number(req.params.id), req.userId);
  if (!ok) return res.status(404).json({ error: '文档不存在' });
  res.json({ ok: true });
});

export default router;
