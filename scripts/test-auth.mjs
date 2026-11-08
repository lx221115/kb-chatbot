const BASE = 'http://localhost:3000';
let TOKEN = '';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
const out = (label, v) => console.log(`\n=== ${label} ===\n` + JSON.stringify(v).slice(0, 600));

// 未登录访问受保护接口
out('未登录 GET /api/documents', await req('/api/documents'));

// 注册 + 登录
let reg = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'pass123456' }) });
if (reg.status === 409) reg = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'pass123456' }) });
out('注册/登录', reg);
TOKEN = reg.data.token;

const login = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'wrongpass' }) });
out('错误密码登录(应401)', login.status);

out('me', await req('/api/auth/me'));

// 设置：保存 anthropic 配置后读回
await req('/api/settings', { method: 'PUT', body: JSON.stringify({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test1234567890', model: 'claude-sonnet-4-5' }) });
out('设置读回', await req('/api/settings'));

// 知识库入库（归属当前用户）
const doc = await req('/api/documents', { method: 'POST', body: JSON.stringify({ type: 'text', title: 'SAG2要点', content: 'SAG2 无需嵌入模型，索引只用 SQLite FTS5 与 BM25。查询时多跳检索并由 JEV 验证证据。' }) });
out('入库', doc);

// 会话内指令
const cmd = await req('/api/chat', { method: 'POST', body: JSON.stringify({ message: '/知识库列表' }) });
out('指令 /知识库列表', cmd.data.reply);
const convId = cmd.data.conversationId;

// 同一会话继续对话（命令），验证历史落库
await req('/api/chat', { method: 'POST', body: JSON.stringify({ message: '/查询知识库 JEV', conversationId: convId }) });
const conv = await req('/api/conversations/' + convId);
out('会话消息数', conv.data.messages.length);

// 普通提问：tester 配了无效 anthropic key，应返回 500 错误信息
const chat = await req('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'SAG2 索引需要模型吗', conversationId: convId }) });
out('无效key提问(应500)', { status: chat.status, error: chat.data.error?.slice(0, 80) });

// 空 apiKey 保存应保留原密钥
await req('/api/settings', { method: 'PUT', body: JSON.stringify({ provider: 'anthropic', apiKey: '', model: 'claude-sonnet-4-5' }) });
out('空key保存后读回(应hasKey=true)', (await req('/api/settings')).data.hasKey);

// 会话列表 / 删除
const list = await req('/api/conversations');
out('会话列表', list.data.map((c) => ({ id: c.id, title: c.title })));
out('删除会话', await req('/api/conversations/' + convId, { method: 'DELETE' }));

// 用户隔离：新用户看不到 tester 的知识库
let reg2 = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'tester2', password: 'pass123456' }) });
if (reg2.status === 409) reg2 = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester2', password: 'pass123456' }) });
TOKEN = reg2.data.token;
out('新用户文档列表(应为空)', await req('/api/documents'));
const chat2 = await req('/api/chat', { method: 'POST', body: JSON.stringify({ message: 'SAG2 索引需要模型吗' }) });
out('无key用户提问(应降级提示)', chat2.data.reply?.slice(0, 40));

// 登出后 token 失效
await req('/api/auth/logout', { method: 'POST' });
out('登出后访问(应401)', (await req('/api/documents')).status);
