import { db } from './db.js';

// 用户名不可修改，按 userId 缓存查询即可；日志高频调用时避免重复查库
const cache = new Map();

export function getUsername(userId) {
  if (!userId) return null;
  if (cache.has(userId)) return cache.get(userId);
  const row = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
  const name = row?.username ?? null;
  if (name) cache.set(userId, name);
  return name;
}

export function userMeta(userId) {
  return { userId: userId ?? null, username: getUsername(userId) };
}
