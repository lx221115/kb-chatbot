---
name: kb-management
description: Manage the KB Chatbot knowledge base (SAG2: SQLite FTS5 + BM25 + JEV) through its built-in MCP endpoint. Use when an agent needs to add, list, read, update, delete, or search knowledge documents, ingest text/files/web URLs, or ask the knowledge-base bot questions via kb_chat. Triggers on requests like "加入知识库 / 更新知识库 / 删除文档 / 检索知识库 / 问知识库".
---

# KB Chatbot 知识库管理

## Overview

本 skill 让任意支持 Streamable HTTP MCP 的 agent 直接操作 KB Chatbot 的知识库：文本/文件/URL 入库、列出、读取、更新、删除、BM25 检索，以及调用机器人问答（含 `/` 斜杠指令）。MCP 端点内置于 Chat 服务本身（`POST /api/mcp`），不需要额外启动 MCP 进程，数据按 Bearer token 对应的登录用户隔离。

## 前置条件

1. KB Chatbot 后端已启动，默认地址 `http://localhost:3000`（项目根目录执行 `pnpm dev:server` 或 `pnpm start`）。MCP 与 Chat 是同一个进程、同一个端口。
2. 已存在一个账号（Web 界面注册，或调用 `POST /api/auth/register`）。
3. 持有一个有效的登录 token（见下文「获取 token」）。

## 获取 token

调用登录接口换取 token：

```bash
curl -s http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<用户名>","password":"<密码>"}'
# => {"token":"<TOKEN>","userId":1,"username":"..."}
```

token 存在服务端 `sessions` 表（SQLite，跨重启保留），调用 `/api/auth/logout` 后失效，届时重新登录即可。

## MCP 配置

在目标 agent 的 MCP 配置（如 `.qoder/mcp.json`、`claude_desktop_config.json`、`mcpServers` 段）中加入：

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

- 服务端无状态（不返回 `Mcp-Session-Id`），每个请求都需携带 `Authorization`，token 决定了操作哪个用户的知识库。
- 若目标客户端把 Streamable HTTP 写作 `"transport": "streamable-http"`，按该客户端的字段名填写，`url` 与 `headers` 不变。
- 远程部署时把 `http://localhost:3000` 换成实际地址；对外暴露请配合反向代理与 HTTPS。
- 不要把长期有效的 token 写进会被提交的仓库文件；用目标 agent 的密钥/环境配置注入。

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

在 KB Chatbot 项目根目录运行 `node scripts/test-mcp.mjs`，会通过 HTTP 调用 `/api/mcp` 跑完整增删改查回归（需后端在 `localhost:3000` 运行；脚本会自动注册/登录 `tester` 账号）。原始协议请求也可直接发：

```bash
curl -s http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <TOKEN>" \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
