---
name: kb-management
description: Manage the KB Chatbot knowledge base (SAG2: SQLite FTS5 + BM25 + JEV) through an MCP server. Use when an agent needs to add, list, read, update, delete, or search knowledge documents, ingest text/files/web URLs, or ask the knowledge-base bot questions via kb_chat. Triggers on requests like "加入知识库 / 更新知识库 / 删除文档 / 检索知识库 / 问知识库".
---

# KB Chatbot 知识库管理

## Overview

本 skill 让任意支持 MCP 的 agent 通过 stdio MCP 服务器操作 KB Chatbot 的知识库：文本/文件/URL 入库、列出、读取、更新、删除、BM25 检索，以及调用机器人问答（含 `/` 斜杠指令）。服务器只是 KB Chatbot REST API 的瘦封装，数据按登录用户隔离。

## 前置条件

1. KB Chatbot 后端已启动，默认监听 `http://localhost:3000`（在项目根目录执行 `pnpm dev:server` 或 `pnpm start`）。
2. 已存在一个账号（在 Web 界面注册，或调用 `/api/auth/register`）。知识库、会话都按该账号隔离。
3. 目标 agent 的 Node.js ≥ 18（用于运行 MCP 服务器进程）。

## MCP 服务器配置

在目标 agent 的 MCP 配置（如 `.qoder/mcp.json`、`claude_desktop_config.json`、`mcpServers` 段）中加入以下条目。把 `/ABS/PATH/TO/kb-chatbot` 替换为本项目实际绝对路径。

```json
{
  "mcpServers": {
    "kb-chatbot": {
      "command": "node",
      "args": ["/ABS/PATH/TO/kb-chatbot/server/mcp.js"],
      "env": {
        "KB_BASE_URL": "http://localhost:3000",
        "KB_USERNAME": "tester",
        "KB_PASSWORD": "pass123456"
      }
    }
  }
}
```

Windows 路径示例：`"args": ["F:/work/kb-chatbot/server/mcp.js"]`。

### 凭证二选一

- **用户名密码（推荐，自动登录换 token）**：设置 `KB_USERNAME` + `KB_PASSWORD`。服务器首次调用时用 `/api/auth/login` 换取 token 并缓存于进程内。
- **直接给 token**：设置 `KB_TOKEN`（Web 登录后 localStorage `kb_token` 的值，或 `/api/auth/login` 返回的 `token`）。设置了 `KB_TOKEN` 时优先使用它。

不要把长期有效的凭证写进会被提交的仓库文件；用目标 agent 的密钥/环境配置注入。

## 工具清单

| 工具 | 作用 | 关键参数 |
|------|------|----------|
| `kb_add_text` | 添加一段文本知识 | `content`(必填), `title`(可选) |
| `kb_add_file` | 以文件名义添加文本内容 | `filename`, `content` |
| `kb_add_url` | 抓取网页正文入库 | `url` |
| `kb_list_documents` | 列出全部文档 | 无 |
| `kb_get_document` | 读取文档详情与分块 | `id` |
| `kb_update_document` | 改标题或内容（改内容会重新分块索引） | `id`, `title?`, `content?` |
| `kb_delete_document` | 删除文档及其全部片段（不可恢复） | `id` |
| `kb_search` | BM25 全文检索，返回相关片段 | `query` |
| `kb_chat` | 机器人问答：SAG2 多跳检索 + JEV 验证 + LLM 生成；`/` 开头按指令执行 | `message`, `conversationId?` |

所有工具返回 JSON 文本；出错时返回 `isError: true` 且文本以「错误：」开头。

## 使用指引

- **增**：优先 `kb_add_text`；有源网页用 `kb_add_url`（自动抽取正文与标题）；模拟文件上传用 `kb_add_file`。入库即自动分块并建立 BM25 索引，零模型调用。
- **查**：先 `kb_list_documents` 拿 id，再 `kb_get_document` 读全文；只想找相关片段用 `kb_search`（比读取整篇更省 token）。
- **改**：`kb_update_document` 传 `content` 会丢弃旧分块并重新索引；只传 `title` 则仅改名。
- **删**：`kb_delete_document` 不可逆，删除前建议先 `kb_get_document` 确认标题。
- **问**：`kb_chat` 面向"根据知识库回答"。需要机器人自动检索并综合时用自然语言 `message`；需要确定性执行某项管理动作时，用 `/` 指令，例如 `/知识库列表`、`/查询知识库 <关键词>`、`/添加知识库 <文本>`、`/帮助`。
- **未配置模型密钥时**：`kb_chat` 的自然语言问答会降级为提示（需要用户在 Web「模型设置」或后端 `.env` 配置 LLM Key），但 `/` 指令与 `kb_search`、增删改查仍完全可用。

## 典型流程

1. 用户给一批资料 → 逐条 `kb_add_text`（或 `kb_add_url`）入库。
2. 用户提问 → `kb_search` 快速定位，或 `kb_chat` 让机器人生成带证据的回答。
3. 用户要修订 → `kb_list_documents` 找到 id → `kb_update_document`。
4. 用户要清理 → `kb_delete_document`。

## 验证

在 KB Chatbot 项目根目录运行 `node scripts/test-mcp.mjs`，会以 stdio 拉起 MCP 服务器并跑完整增删改查回归（需后端在 `localhost:3000` 运行且存在 `tester/pass123456` 账号，或按需修改脚本顶部的环境变量）。
