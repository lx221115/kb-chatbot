import { Router } from 'express';
import { authMiddleware, login, logout, register } from '../services/auth.js';
import { db } from '../lib/db.js';

const router = Router();

// 公开接口：注册 / 登录
router.post('/register', (req, res) => {
  res.json(register(req.body?.username, req.body?.password));
});

router.post('/login', (req, res) => {
  res.json(login(req.body?.username, req.body?.password));
});

// 需登录：登出 / 当前用户
router.post('/logout', authMiddleware, (req, res) => {
  logout(req.token);
  res.json({ ok: true });
});

router.get('/me', authMiddleware, (req, res) => {
  res.json(db.prepare('SELECT id, username FROM users WHERE id=?').get(req.userId));
});

export default router;
