function positiveInt(raw, fallback) {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const MAX_UPLOAD_MB = positiveInt(process.env.MAX_UPLOAD_MB, 100);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

// 文本/URL 入库走 JSON，不经过 worker，单独限制避免主线程内存峰值
export const MAX_JSON_BODY_MB = positiveInt(process.env.MAX_JSON_BODY_MB, 30);

export const PARSER_CONCURRENCY = positiveInt(process.env.PARSER_CONCURRENCY, 1);
export const PARSER_MEMORY_MB = positiveInt(process.env.PARSER_MEMORY_MB, 768);
export const PARSER_TIMEOUT_MS = positiveInt(process.env.PARSER_TIMEOUT_MS, 5 * 60 * 1000);
