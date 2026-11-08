import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 日志目录固定为项目根 logs/（基于本模块位置解析，不受进程 cwd 影响）
const LOG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs');
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 20;

let currentDate = null;
let stream = null;
let echoToConsole = false;

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function stamp(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

// 按天拆分：日期变化时切换到新文件 app-YYYY-MM-DD.log
function ensureStream(now) {
  const ds = dateStr(now);
  if (ds !== currentDate) {
    if (stream) stream.end();
    fs.mkdirSync(LOG_DIR, { recursive: true });
    currentDate = ds;
    stream = fs.createWriteStream(path.join(LOG_DIR, `app-${ds}.log`), { flags: 'a' });
  }
  return stream;
}

function write(level, scope, message, meta) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const now = new Date();
  let line = `[${stamp(now)}] [${level.toUpperCase()}] [${scope}] ${message}`;
  if (meta !== undefined && meta !== null) {
    try {
      line += ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
    } catch {
      line += ' [unserializable meta]';
    }
  }
  ensureStream(now).write(line + '\n');
  // 回显走 stderr，保持 stdout 干净，便于管道与容器日志区分
  if (echoToConsole) process.stderr.write(line + '\n');
}

export function initLogger({ echo = false } = {}) {
  echoToConsole = echo;
}

export const logger = {
  debug: (scope, message, meta) => write('debug', scope, message, meta),
  info: (scope, message, meta) => write('info', scope, message, meta),
  warn: (scope, message, meta) => write('warn', scope, message, meta),
  error: (scope, message, meta) => write('error', scope, message, meta)
};

export { LOG_DIR };
