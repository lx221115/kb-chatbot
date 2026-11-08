// MCP over HTTP 回归测试：登录拿 token，直接打 POST /api/mcp
const BASE = 'http://localhost:3000';
const PROTOCOL = '2025-06-18';

async function login() {
  let res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'pass123456' })
  });
  if (!res.ok) {
    res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tester', password: 'pass123456' })
    });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '登录失败');
  return data.token;
}

const TOKEN = await login();
let seq = 0;

async function rpc(method, params, token = TOKEN) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params })
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function notify(method) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL,
      Authorization: `Bearer ${TOKEN}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', method })
  });
  return res.status;
}

let passed = 0;
let failed = 0;
function check(label, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`✓ ${label}`);
  } else {
    failed++;
    console.log(`✗ ${label} ${extra}`);
  }
}

// 未授权
const noAuth = await rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 't', version: '1' } }, '');
check('无 token 调用 MCP 返回 401', noAuth.status === 401, `status=${noAuth.status}`);

// 初始化
const init = await rpc('initialize', {
  protocolVersion: PROTOCOL,
  capabilities: {},
  clientInfo: { name: 'test-client', version: '1.0.0' }
});
check('initialize', init.json?.result?.serverInfo?.name === 'kb-chatbot', JSON.stringify(init.json).slice(0, 200));
check('notifications/initialized 返回 202', (await notify('notifications/initialized')) === 202);

const list = await rpc('tools/list', {});
const names = list.json?.result?.tools?.map((t) => t.name) || [];
check('tools/list 含 9 个工具', names.length === 9, names.join(','));
for (const n of ['kb_add_text', 'kb_add_url', 'kb_add_file', 'kb_list_documents', 'kb_get_document', 'kb_update_document', 'kb_delete_document', 'kb_search', 'kb_chat']) {
  check(`工具存在 ${n}`, names.includes(n));
}

async function callTool(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const text = r.json?.result?.content?.[0]?.text || '';
  return { isError: !!r.json?.result?.isError, text, json: r.json?.result?.isError ? null : JSON.parse(text) };
}

// 增
const added = await callTool('kb_add_text', { title: 'MCP 测试文档', content: '量子计算利用量子比特进行并行计算。MCP 测试标记 Zz9x。' });
check('kb_add_text 入库', !added.isError && added.json?.id > 0, added.text.slice(0, 200));
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

// 改
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

// 非 POST 方法
const getRes = await fetch(`${BASE}/api/mcp`, { headers: { Authorization: `Bearer ${TOKEN}` } });
check('GET /api/mcp 返回 405', getRes.status === 405);
const delRes = await fetch(`${BASE}/api/mcp`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } });
check('DELETE /api/mcp 返回 405', delRes.status === 405);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
