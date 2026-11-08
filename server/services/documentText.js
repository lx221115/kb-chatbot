import path from 'node:path';
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
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

// 纯文本按流解码：只保留 64KB 输入块 + 结果字符串，避免整文件 Buffer 与字符串同时驻留
async function decodePlainTextFile(filePath) {
  const handle = await open(filePath, 'r');
  const head = Buffer.alloc(3);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(head, 0, 3, 0));
  } finally {
    await handle.close();
  }

  if (bytesRead >= 2 && head[0] === 0xfe && head[1] === 0xff) {
    // 大端 UTF-16 先整读再字节交换，这种编码极少见，单独处理
    const raw = await readFile(filePath);
    const body = raw.subarray(2, raw.length - (raw.length % 2));
    const swapped = Buffer.from(body);
    swapped.swap16();
    return swapped.toString('utf16le');
  }

  let skip = 0;
  let encoding = 'utf8';
  if (bytesRead >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) {
    skip = 3;
  } else if (bytesRead >= 2 && head[0] === 0xff && head[1] === 0xfe) {
    skip = 2;
    encoding = 'utf16le';
  }

  const decoder = new StringDecoder(encoding);
  const parts = [];
  let first = true;
  for await (const chunk of createReadStream(filePath)) {
    let buf = chunk;
    if (first) {
      first = false;
      if (skip) buf = buf.subarray(skip);
    }
    parts.push(decoder.write(buf));
  }
  parts.push(decoder.end());
  return parts.join('');
}

async function extractDocx(filePath) {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value;
}

function extractSpreadsheet(filePath) {
  const workbook = XLSX.readFile(filePath, { dense: true });
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

async function extractPptx(filePath) {
  const buffer = await readFile(filePath);
  // 只解压幻灯片 XML，避免图片/媒体占用内存
  const files = unzipSync(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), {
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

async function extractPdf(filePath) {
  const buffer = await readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
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

async function extractByExtension(ext, filePath) {
  if (['.txt', '.md', '.markdown', '.csv', '.log', '.json'].includes(ext)) {
    return decodePlainTextFile(filePath);
  }
  if (ext === '.docx') return extractDocx(filePath);
  if (ext === '.xlsx' || ext === '.xls') return extractSpreadsheet(filePath);
  if (ext === '.pptx') return extractPptx(filePath);
  if (ext === '.pdf') return extractPdf(filePath);
  if (LEGACY_HINT[ext]) throw httpError(LEGACY_HINT[ext]);
  throw httpError(`暂不支持 ${ext} 格式，支持：${SUPPORTED_EXTENSIONS.join(' / ')}`);
}

export async function extractDocumentText(filePath, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!ext) throw httpError('文件缺少扩展名，无法判断格式');
  if (LEGACY_HINT[ext]) throw httpError(LEGACY_HINT[ext]);
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw httpError(`暂不支持 ${ext} 格式，支持：${SUPPORTED_EXTENSIONS.join(' / ')}`);
  }

  let text;
  try {
    text = await extractByExtension(ext, filePath);
  } catch (err) {
    if (err.status) throw err;
    throw httpError(`${ext.slice(1).toUpperCase()} 解析失败：${err.message}`);
  }

  // 合并成一次替换，避免大文本连续多次全量拷贝；\n{3,} 需排在单 \n 匹配之前
  const normalized = text
    .replace(/\n{3,}|[ \t]*\r?\n|\r/g, (match) => (match[0] === '\n' ? '\n\n' : '\n'))
    .trim();

  if (!normalized) {
    throw httpError('未能从文件中提取到文本（扫描版 PDF 或纯图片文档无法解析）');
  }
  return { text: normalized, format: ext.slice(1) };
}
