const BASE = 'http://localhost:3000';
let TOKEN = '';

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    ...options
  });
  return res.json();
}

const out = (label, data) => console.log(`\n=== ${label} ===\n` + JSON.stringify(data, null, 2).slice(0, 1200));

let auth = await req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'apitester', password: 'pass123456' }) });
if (auth.error) auth = await req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'apitester', password: 'pass123456' }) });
TOKEN = auth.token;
out('登录', { hasToken: !!TOKEN });

const doc1 = await req('/api/documents', {
  method: 'POST',
  body: JSON.stringify({
    type: 'text',
    title: 'SAG2简介',
    content:
      'SAG2 是一种无嵌入的检索增强生成架构。它只依赖单个 SQLite 数据库，使用 FTS5 实现 BM25 词法索引，索引阶段不需要调用任何模型。查询时通过 term-to-passage 扩展实现多跳检索，再由 JEV（Joint Evidence Validator）对候选证据做上下文联合验证。在 MuSiQue 数据集上 Recall@10 达到 86.62%，超过第一代 SAG 和稠密向量检索方案。'
  })
});
out('添加文本文档', doc1);

const doc2 = await req('/api/documents', {
  method: 'POST',
  body: JSON.stringify({
    type: 'file',
    filename: '项目约定.md',
    content:
      '本项目使用 pnpm 管理依赖，前端为 Vue3 + Vite，后端为 Node.js + Express + better-sqlite3。开发时运行 pnpm dev 同时启动前后端，生产环境先 pnpm build 再 pnpm start。数据库文件存放在 data/kb.db。'
  })
});
out('添加文件文档', doc2);

out('文档列表', await req('/api/documents'));
out('BM25 检索「多跳检索」', await req('/api/search?q=' + encodeURIComponent('多跳检索')));

out('指令 /知识库列表', await req('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: '/知识库列表' })
}));

out('指令 /查询知识库 JEV', await req('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: '/查询知识库 JEV 验证' })
}));

out('指令 /更新知识库', await req('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: `/更新知识库 ${doc2.id}|本项目使用 pnpm 管理依赖。数据库为 SQLite（data/kb.db），检索采用 SAG2 架构。前端 Vue3 + Vite，后端 Express + better-sqlite3。` })
}));

out('更新后检索「pnpm」', await req('/api/search?q=' + encodeURIComponent('pnpm 依赖管理')));

out('指令 /添加知识库(会话内文本)', await req('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: '/添加知识库 会议纪要|2026-11-07 决定采用 SAG2 架构，因其索引无需模型调用，动态增删改查只是 SQL 行操作。' })
}));

out('指令 /删除知识库', await req('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: `/删除知识库 ${doc2.id}` })
}));

out('指令 /帮助', (await req('/api/chat', { method: 'POST', body: JSON.stringify({ message: '/帮助' }) })).reply.slice(0, 200));
out('最终文档列表', await req('/api/documents'));
