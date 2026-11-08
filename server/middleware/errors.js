import { logger } from '../lib/logger.js';

// 包装 async 路由，把 Promise 拒绝转交给统一错误处理
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function apiNotFound(req, res) {
  res.status(404).json({ error: '接口不存在' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  logger[status >= 500 ? 'error' : 'warn']('http', `${req.method} ${req.originalUrl} failed`, {
    status,
    userId: req.userId ?? null,
    username: req.username ?? null,
    error: err.message
  });
  res.status(status).json({ error: err.message });
}
