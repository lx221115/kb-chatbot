import path from 'node:path';
import mammoth from 'mammoth';
import XLSX from 'xlsx';
import { strFromU8, unzipSync } from 'fflate';
import { extractText, getDocumentProxy } from 'unpdf';

export const SUPPORTED_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.log',
  '.json',
  '.docx',
  '.xlsx',
  '.xls',
  '.pptx',
  '.pdf'
];

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

const LEGACY_HINT = {
  '.doc': '不支持旧版 .doc 二进制格式，请用 Word 另存为 .docx 后上传',
  '.ppt': '不支持旧版 .ppt 二进制格式，请用 PowerPoint 另存为 .pptx 后上传'
};

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function httpError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function normalizeFilename(name) {
  const base = path.basename(String(name || ''))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return base || '未命名文件';
}

// multer 按 latin1 解析 multipart filename，非 ASCII 文件名会乱码；前端另传 filename 字段优先
export function restoreFilename(name) {
  const raw = String(name || '');
  if (!raw || !/[\u0080-\u00ff]/.test(raw) || /[\u4e00-\u9fff]/.test(raw)) return raw;
  const fixed = Buffer.from(raw, 'latin1').toString('utf8');
  return fixed.includes('\ufffd') ? raw : fixed;
}

function decodeXml(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return XML_ENTITIES[entity] ?? match;
  });
}

function decodePlainText(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return buffer.toString('utf8');
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function extractSpreadsheet(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils
      .sheet_to_csv(sheet, { blankrows: false, strip: true, raw: false })
      .trim();
    if (csv) parts.push(`## 工作表：${name}\n${csv}`);
  }
  return parts.join('\n\n');
}

function slideXmlToText(xml) {
  const lines = [];
  for (const paragraph of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const inner = paragraph[1].replace(/<a:br\s*\/>/g, '\n');
    const text = [...inner.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((m) => decodeXml(m[1]))
      .join('')
      .trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

function extractPptx(buffer) {
  // 只解压幻灯片 XML，避免图片/媒体占用内存
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.name)
  });
  const slides = Object.keys(files)
    .map((name) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
      return match ? { name, index: Number(match[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  if (!slides.length) throw new Error('文件中未找到幻灯片');

  return slides
    .map(({ name, index }) => {
      const text = slideXmlToText(strFromU8(files[name]));
      return text ? `## 幻灯片 ${index}\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function extractPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages
    .map((page, i) => {
      const body = (page || '').trim();
      return body ? `## 第 ${i + 1} 页\n${body}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

async function extractByExtension(ext, buffer) {
  if (['.txt', '.md', '.markdown', '.csv', '.log', '.json'].includes(ext)) {
    return decodePlainText(buffer);
  }
  if (ext === '.docx') return extractDocx(buffer);
  if (ext === '.xlsx' || ext === '.xls') return extractSpreadsheet(buffer);
  if (ext === '.pptx') return extractPptx(buffer);
  if (ext === '.pdf') return extractPdf(buffer);
  if (LEGACY_HINT[ext]) throw httpError(LEGACY_HINT[ext]);
  throw httpError(`暂不支持 ${ext} 格式，支持：${SUPPORTED_EXTENSIONS.join(' / ')}`);
}

export async function extractDocumentText(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) throw httpError('文件缺少扩展名，无法判断格式');
  if (LEGACY_HINT[ext]) throw httpError(LEGACY_HINT[ext]);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw httpError(`暂不支持 ${ext} 格式，支持：${SUPPORTED_EXTENSIONS.join(' / ')}`);
  }

  let text;
  try {
    text = await extractByExtension(ext, buffer);
  } catch (err) {
    if (err.status) throw err;
    throw httpError(`${ext.slice(1).toUpperCase()} 解析失败：${err.message}`);
  }

  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!normalized) {
    throw httpError('未能从文件中提取到文本（扫描版 PDF 或纯图片文档无法解析）');
  }
  return { text: normalized, format: ext.slice(1) };
}
