# KB Chatbot — 基于 SAG2 的可动态增删改查知识库聊天机器人

一个可在对话过程中用斜杠指令动态管理知识库的聊天机器人。知识库支持**文件 / URL / 文本**三种初始化方式（输入框上方工具栏一键触达），检索采用 **SAG2 架构**（arXiv:2610.22588，*SAG2: Embedding-Free Multi-Hop Retrieval with BM25 and JEV*）。

界面为 DeepSeek 官网风格：左侧历史会话栏、居中简洁对话流、底部卡片式输入框。

## 为什么选 SAG2

| 维度 | 向量 RAG | GraphRAG | **SAG2** |
|---|---|---|---|
| 索引成本 | 需 embedding 模型 | 需 LLM 抽实体/建图 | **零模型调用**，仅 SQLite FTS5 + BM25 |
| 动态增删改查 | 增删需重嵌入 | 需增量重建图 | **纯 SQL 行操作**，即时生效 |
| 多跳检索 | 弱 | 强但慢 | term-to-passage 扩展，MuSiQue Recall@10 86.62% |
| 准确性保障 | 相似度阈值 | 图结构 | **JEV**（LLM 联合证据验证）查询时打分 |

对本项目"会话中动态增删改查知识库"的核心诉求，SAG2 是唯一让**写路径零成本、读路径高精度**的方案。

## 功能

- **用户登录**：注册/登录（scrypt 哈希 + 随机 token 会话），知识库与会话按用户隔离
- **深色模式**：CSS 变量主题，登录页与侧栏均有切换按钮；首次跟随系统偏好，之后记忆于 localStorage（`kb_theme`）
- **历史会话**：左侧栏列出全部会话，点击恢复上下文，可新建/删除；标题取自首条消息
- **模型设置**：每用户独立配置，支持 **OpenAI 兼容协议**（DeepSeek / OpenAI / 通义 / Moonshot / Ollama…）与 **Anthropic Messages 协议**，含快捷预设；未配置时服务端 .env 的 `LLM_API_KEY` 作为兜底
- **知识库管理**：右侧抽屉，文档列表/详情/删除 + 文本/链接入库；聊天输入框上方工具栏可直接上传文件
- **会话内指令**：见下表
- **MCP 对外暴露**：知识库增删改查/检索/问答可通过 MCP 服务器被其他 agent 调用，见下文
- **运行日志**：`server/logger.js` 无依赖记录运行日志，输出到项目根 `logs/app-YYYY-MM-DD.log`，按天自动切分文件
- **降级可用**：未配置模型密钥时，指令与检索仍完全可用，仅生成回答提示配置

### 会话内指令

| 指令 | 作用 |
|---|---|
| `/添加知识库 <内容>` | 文本入库 |
| `/添加知识库 url:<网址>` | 抓取网页正文入库（支持公众号等常见站点） |
| `/更新知识库 <文档ID>|<新内容>` | 整篇替换 |
| `/删除知识库 <文档ID>` | 删除文档及全部片段 |
| `/查询知识库 <关键词>` | 只检索不生成，展示匹配片段 |
| `/知识库列表` | 列出全部文档 |
| `/帮助` | 指令帮助 |

支持别名：`/新增知识库`、`/修改知识库`、`/搜索知识库` 等。

## 快速开始

```bash
pnpm install          # 或 npx pnpm@9 install（pnpm 7 与 Node 22 不兼容）
cp .env.example .env  # 可选：服务端兜底密钥；不填也可登录后在「模型设置」中配置
pnpm dev              # 前端 http://localhost:5173，后端 http://localhost:3000
pnpm build && pnpm start   # 生产模式：Express 直接托管 web/dist
```

首次使用：打开页面 → 注册账号 → 左下角「模型设置」填写协议/Base URL/API Key/模型名 → 开始对话。

## REST API

- `POST /api/auth/register|login|logout`、`GET /api/auth/me`
- `GET|PUT /api/settings` — 当前用户的模型配置（读回时密钥掩码）
- `GET|POST /api/conversations`、`GET|PUT|DELETE /api/conversations/:id`
- `GET|POST /api/documents`、`GET|PUT|DELETE /api/documents/:id` — 知识库 CRUD（按用户隔离）
- `GET /api/search?q=` — 纯 BM25 检索
- `POST /api/chat {message, conversationId?}` — 对话入口：`/` 开头走指令，否则 SAG2 检索 + JEV + 生成；自动创建/续写会话并落库
- 除 `/api/health` 与认证接口外均需 `Authorization: Bearer <token>`

## MCP 对外暴露（供其他 agent 调用）

MCP 与 Chat 服务是**同一个进程、同一个端口**：`POST /api/mcp` 是 Streamable HTTP（无状态）端点，随服务启动自动可用，不需要单独运行 MCP 进程。它把知识库增删改查/检索/问答封装为 9 个工具，供任意 MCP 客户端（Qoder、Claude Desktop 等）调用，复用同一套 Bearer 鉴权，数据按登录用户隔离。

工具：`kb_add_text`、`kb_add_file`、`kb_add_url`、`kb_list_documents`、`kb_get_document`、`kb_update_document`、`kb_delete_document`、`kb_search`、`kb_chat`。

先用账号换取 token：

```bash
curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"tester","password":"pass123456"}'
```

然后在目标 agent 的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "kb-chatbot": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer <TOKEN>"
      }
    }
  }
}
```

服务端无状态（每次请求独立处理），每个请求都要带 `Authorization`；token 失效（登出）后重新登录即可。远程部署时替换 `url`，并建议放在 HTTPS 反向代理之后。

### 可移植 Skill

`skills/kb-management/SKILL.md` 是打包好的技能说明，可直接复制到其他 agent 的技能目录（如 `.qoder/skills/` 或用户级 skills 目录），其中含完整的 MCP 配置、工具清单与使用指引。

回归测试：`node scripts/test-mcp.mjs`（需后端运行，脚本自动注册/登录 `tester` 账号）。

## 运行日志

`server/logger.js` 是零依赖日志模块，输出到项目根目录 `logs/`，**按天拆分**为 `app-YYYY-MM-DD.log`（本地日期，跨天自动切换新文件，历史文件保留）。日志目录基于模块自身位置解析，进程从任意 cwd 启动都写到同一 `logs/`。

- 记录范围：HTTP 访问（方法/路径/状态/耗时/IP/userId）、注册登录、知识库增删改、指令执行、LLM 调用耗时与错误、对话轮次、MCP 工具调用
- 级别：`DEBUG/INFO/WARN/ERROR`，通过环境变量 `LOG_LEVEL` 调整阈值，默认 `INFO`
- 格式：`[本地时间] [级别] [作用域] 消息 {元数据}`
- MCP 工具调用与 HTTP 请求写同一份日志（`[mcp]` 作用域），全部输出到文件并回显 stderr
- `logs/` 已在 `.gitignore` 中忽略

## 目录结构

```
server/
  index.js        入口：中间件装配、路由挂载、静态资源、启动
  routes/         按资源拆分的路由
    auth.js         注册/登录/登出/当前用户
    settings.js     模型配置
    conversations.js 会话 CRUD
    documents.js    知识库 CRUD（文本/文件/URL 入库）
    search.js       纯 BM25 检索
    chat.js         对话入口（指令 / SAG2 检索 + JEV + 生成）
  middleware/
    accessLog.js    HTTP 访问日志
    errors.js       asyncHandler、统一错误处理、API 404
  conversations.js 会话与消息数据访问
  chat.js          对话轮核心逻辑（指令 / SAG2 检索 + JEV + 生成）
  mcpServer.js     创建绑定当前用户的 MCP 服务器（9 个知识库工具）
  auth.js          注册/登录/token 会话与鉴权中间件
  db.js            SQLite schema（users/sessions/settings/conversations/messages/documents/chunks/fts）
  tokenizer.js     中文 bigram + 英文词分词、停用词
  ingest.js        分块与知识库 CRUD（按 owner 隔离）
  retrieve.js      SAG2：BM25 多跳 + JEV 验证
  commands.js      会话内斜杠指令
  llm.js           OpenAI 兼容 / Anthropic 双协议客户端 + 用户级配置
  urlfetch.js      网页正文抓取（cheerio）
  logger.js        运行日志（按天拆分写 logs/）
web/               Vue3 + Vite 前端（登录页 / 侧栏历史 / 聊天区 / 设置弹窗 / 知识库抽屉；theme.js 深色模式）
skills/            kb-management/SKILL.md（可复制到其他 agent 的知识库管理技能）
scripts/           test-api.mjs（知识库流程）、test-auth.mjs（鉴权/会话/设置回归）、test-mcp.mjs（MCP 全流程回归）
data/kb.db         运行时生成的数据库（gitignore）
logs/              运行日志 app-YYYY-MM-DD.log（gitignore）
```

## 说明

- 文件上传支持纯文本类（.txt/.md/.csv/.json/.log），前端读取文本后走同一入库管线
- API Key 以明文存于本地 SQLite（单机个人应用）；如需共享部署请自行加加密层
