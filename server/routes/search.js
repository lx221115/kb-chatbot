import { Router } from 'express';
import { searchOnly } from '../retrieve.js';

const router = Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '缺少查询词 q' });
  res.json(searchOnly(q, 8, req.userId));
});

export default router;
