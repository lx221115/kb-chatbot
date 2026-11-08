import { Router } from 'express';
import { addDocument, deleteDocument, getDocument, listDocuments, updateDocument } from '../ingest.js';
import { asyncHandler } from '../middleware/errors.js';
import { fetchUrl } from '../urlfetch.js';

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

router.delete('/:id', (req, res) => {
  const ok = deleteDocument(Number(req.params.id), req.userId);
  if (!ok) return res.status(404).json({ error: '文档不存在' });
  res.json({ ok: true });
});

export default router;
