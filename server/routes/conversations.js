import { Router } from 'express';
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation
} from '../services/conversations.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listConversations(req.userId));
});

router.post('/', (req, res) => {
  res.json({ id: createConversation(req.userId, req.body?.title) });
});

router.get('/:id', (req, res) => {
  const conv = getConversation(req.params.id, req.userId);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  res.json(conv);
});

router.put('/:id', (req, res) => {
  res.json({ ok: renameConversation(req.params.id, req.body?.title, req.userId) });
});

router.delete('/:id', (req, res) => {
  res.json({ ok: deleteConversation(req.params.id, req.userId) });
});

export default router;
