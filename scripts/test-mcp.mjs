// MCP stdio 回归测试：spawn server/mcp.js，走 JSON-RPC 全流程
import { spawn } from 'node:child_process';

setTimeout(() => { console.log('✗ 测试超时'); process.exit(1); }, 30000);

const child = spawn('node', ['server/mcp.js'], {
  cwd: process.cwd(),
  env: { ...process.env, KB_USERNAME: 'tester', KB_PASSWORD: 'pass123456' },
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stderr.on('data', (d) => process.stderr.write(`[mcp] ${d}`));

let buf = '';
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let seq = 0;
function send(method, params) {
  const id = ++seq;
  const p = new Promise((resolve) => pending.set(id, resolve));
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return p;
}
function notify(method) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
}

let passed = 0, failed = 0;
function check(label, cond, extra = '') {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label} ${extra}`); }
}

const init = await send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0.0' }
});
check('initialize', init.result?.serverInfo?.name === 'kb-chatbot', JSON.stringify(init).slice(0, 200));
notify('notifications/initialized');

const list = await send('tools/list', {});
const names = list.result?.tools?.map((t) => t.name) || [];
check('tools/list 含 9 个工具', names.length === 9, names.join(','));
for (const n of ['kb_add_text', 'kb_add_url', 'kb_add_file', 'kb_list_documents', 'kb_get_document', 'kb_update_document', 'kb_delete_document', 'kb_search', 'kb_chat']) {
  check(`工具存在 ${n}`, names.includes(n));
}

async function callTool(name, args) {
  const r = await send('tools/call', { name, arguments: args });
  const text = r.result?.content?.[0]?.text || '';
  return { isError: !!r.result?.isError, text, json: r.result?.isError ? null : JSON.parse(text) };
}

// 增
const added = await callTool('kb_add_text', { title: 'MCP 测试文档', content: '量子计算利用量子比特进行并行计算。MCP 测试标记 Zz9x。' });
check('kb_add_text 自动登录并入库', !added.isError && added.json?.id > 0, added.text.slice(0, 200));
const docId = added.json?.id;

const byFile = await callTool('kb_add_file', { filename: 'mcp-note.md', content: '# MCP 笔记\n这是通过 kb_add_file 入库的内容，标记 Qk7m。' });
check('kb_add_file 入库', !byFile.isError && byFile.json?.id > 0, byFile.text.slice(0, 200));
const fileId = byFile.json?.id;

// 查
const listed = await callTool('kb_list_documents', {});
check('kb_list_documents 含新文档', Array.isArray(listed.json) && listed.json.some((d) => d.id === docId));

const got = await callTool('kb_get_document', { id: docId });
check('kb_get_document 返回 chunks', got.json?.chunks?.length > 0, got.text.slice(0, 200));

const searched = await callTool('kb_search', { query: '量子比特 Zz9x' });
check('kb_search 命中', Array.isArray(searched.json) && searched.json.length > 0, searched.text.slice(0, 200));

// 改（仅标题，验证 ingest 修复）
const renamed = await callTool('kb_update_document', { id: docId, title: 'MCP 测试文档（已改名）' });
check('kb_update_document 仅改标题', !renamed.isError && renamed.json?.title === 'MCP 测试文档（已改名）', renamed.text.slice(0, 200));

const rewritten = await callTool('kb_update_document', { id: docId, content: '完全新的内容：光子计算标记 Pp3k。' });
check('kb_update_document 改内容', !rewritten.isError && rewritten.json?.chunkCount > 0, rewritten.text.slice(0, 200));

// 错误处理
const notFound = await callTool('kb_get_document', { id: 999999 });
check('不存在文档返回 isError', notFound.isError && notFound.text.includes('不存在'), notFound.text.slice(0, 120));

// 删
const del1 = await callTool('kb_delete_document', { id: docId });
check('kb_delete_document', !del1.isError && del1.json?.ok === true, del1.text.slice(0, 120));
const del2 = await callTool('kb_delete_document', { id: fileId });
check('kb_delete_document 清理文件文档', !del2.isError, del2.text.slice(0, 120));

const after = await callTool('kb_list_documents', {});
check('删除后列表不含测试文档', !after.json.some((d) => d.id === docId || d.id === fileId));

// 指令通道
const cmd = await callTool('kb_chat', { message: '/知识库列表' });
check('kb_chat 执行斜杠指令', !cmd.isError && cmd.json?.type === 'command', cmd.text.slice(0, 200));

child.stdin.end();
child.kill();
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
