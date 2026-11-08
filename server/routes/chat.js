import { Router } from 'express';
import { runChatTurn } from '../chat.js';

const router = Router();

router.post('/', async (req, res) => {
  const { message, conversationId } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: '消息为空' });

  try {
    res.json(await runChatTurn(req.userId, message, conversationId));
  } catch (err) {
    const body = { error: err.message };
    if (err.conversationId) body.conversationId = err.conversationId;
    res.status(err.status || 500).json(body);
  }
});

export default router;
