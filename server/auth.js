import crypto from 'node:crypto';
import { db } from './db.js';
import { logger } from './logger.js';

function hash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function register(username, password) {
  const name = (username || '').trim();
  if (!/^[A-Za-z0-9_\u4e00-\u9fff]{2,20}$/.test(name)) {
    throw Object.assign(new Error('用户名需为 2-20 位字母、数字、下划线或中文'), { status: 400 });
  }
  if (!password || password.length < 6) {
    throw Object.assign(new Error('密码至少 6 位'), { status: 400 });
  }
  if (db.prepare('SELECT id FROM users WHERE username=?').get(name)) {
    logger.warn('auth', 'register failed: username exists', { username: name });
    throw Object.assign(new Error('用户名已存在'), { status: 409 });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users(username, password_hash, salt) VALUES (?,?,?)')
    .run(name, hash(password, salt), salt);
  logger.info('auth', 'user registered', { userId: lastInsertRowid, username: name });
  return createSession(lastInsertRowid);
}

export function login(username, password) {
  const name = (username || '').trim();
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(name);
  if (!user || user.password_hash !== hash(password || '', user.salt)) {
    logger.warn('auth', 'login failed: bad credentials', { username: name });
    throw Object.assign(new Error('用户名或密码错误'), { status: 401 });
  }
  logger.info('auth', 'user logged in', { userId: user.id, username: name });
  return createSession(user.id);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id) VALUES (?,?)').run(token, userId);
  return { token, userId, username: db.prepare('SELECT username FROM users WHERE id=?').get(userId).username };
}

export function logout(token) {
  const session = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(token);
  db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  if (session) logger.info('auth', 'user logged out', { userId: session.user_id });
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token ? db.prepare('SELECT * FROM sessions WHERE token=?').get(token) : null;
  if (!session) return res.status(401).json({ error: '未登录或登录已失效' });
  req.userId = session.user_id;
  req.token = token;
  next();
}
