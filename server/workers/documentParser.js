import { parentPort } from 'node:worker_threads';
import { extractDocumentText } from '../services/documentText.js';
import { addDocumentFromChunks, toChunkRows } from '../services/ingest.js';
import { splitChunks } from '../lib/chunking.js';

// 解析、分块、分词和 SQLite 落库都在线程内完成，主线程只接收小的入库结果
parentPort.on('message', async ({ filePath, filename, title, ownerId }) => {
  try {
    const { text, format } = await extractDocumentText(filePath, filename);
    const chunks = toChunkRows(splitChunks(text));
    const doc = addDocumentFromChunks({
      title,
      sourceType: 'file',
      sourceRef: filename,
      chunks,
      ownerId
    });
    parentPort.postMessage({ ok: true, format, chars: text.length, doc });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err.message, status: err.status || 400 });
  }
});
