const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 60;

export function splitChunks(text) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 1 > CHUNK_SIZE) {
      chunks.push(buf.trim());
      buf = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP));
    }
    buf = buf ? buf + '\n' + p : p;
    while (buf.length > CHUNK_SIZE * 2) {
      chunks.push(buf.slice(0, CHUNK_SIZE).trim());
      buf = buf.slice(CHUNK_SIZE - CHUNK_OVERLAP);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}
