import { Worker } from 'node:worker_threads';
import { PARSER_CONCURRENCY, PARSER_MEMORY_MB, PARSER_TIMEOUT_MS } from './config.js';

const WORKER_URL = new URL('../workers/documentParser.js', import.meta.url);

let active = 0;
const queue = [];

function httpError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function runTask({ filePath, filename, title, ownerId }) {
  return new Promise((resolve, reject) => {
    // 每个任务独立 Worker，结束后内存整体归还，避免解析器的峰值常驻主进程
    const worker = new Worker(WORKER_URL, {
      resourceLimits: { maxOldGenerationSizeMb: PARSER_MEMORY_MB }
    });
    let settled = false;

    const finish = (done, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      done(value);
    };

    const timer = setTimeout(() => {
      finish(reject, httpError(`文件解析超时（超过 ${Math.round(PARSER_TIMEOUT_MS / 1000)} 秒），请拆分后重试`));
    }, PARSER_TIMEOUT_MS);

    worker.once('message', (msg) => {
      if (msg?.ok) return finish(resolve, msg);
      finish(reject, Object.assign(new Error(msg?.error || '文件解析失败'), { status: msg?.status || 400 }));
    });
    worker.once('error', (err) => {
      const outOfMemory = err.code === 'ERR_WORKER_OUT_OF_MEMORY' || /heap|memory/i.test(err.message);
      const message = outOfMemory
        ? `文件解析内存不足（上限 ${PARSER_MEMORY_MB}MB），请拆分文件或调大 PARSER_MEMORY_MB`
        : `文件解析失败：${err.message}`;
      finish(reject, httpError(message));
    });
    worker.once('exit', (code) => {
      if (!settled) finish(reject, httpError(`解析进程异常退出（code ${code}），文件可能过大`));
    });

    worker.postMessage({ filePath, filename, title, ownerId });
  });
}

// 串行排队：解析单个大文件就可能吃掉数百 MB，默认不并发
export function parseDocumentFile(filePath, filename, { title, ownerId }) {
  return new Promise((resolve, reject) => {
    queue.push({ filePath, filename, title, ownerId, resolve, reject });
    drain();
  });
}

function drain() {
  while (active < PARSER_CONCURRENCY && queue.length) {
    const task = queue.shift();
    active += 1;
    runTask(task)
      .then(task.resolve, task.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  }
}
