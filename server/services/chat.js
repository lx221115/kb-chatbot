import { logger } from '../lib/logger.js';
import { userMeta } from '../lib/userMeta.js';
import { isCommand, runCommand } from './commands.js';
import { addMessage, conversationOwned, createConversation, getHistory, touchConversation } from './conversations.js';
import { chatCompletion, getLlmConfig, llmConfigured } from './llm.js';
import { retrieve } from './retrieve.js';

function previewText(text, max = 200) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

// 未配置模型时降级为纯检索：直接返回 BM25 命中的片段，跳过 JEV 与生成
function formatRetrievalReply(evidence) {
  if (!evidence.length) {
    return (
      '当前未配置模型密钥，已自动切换为纯检索模式（BM25 多跳，未做 JEV 验证与模型生成）。\n\n' +
      '知识库中未检索到相关内容。可以尝试更换关键词，或先添加相关文档；' +
      '配置模型后可在检索结果基础上生成整合回答。'
    );
  }
  const items = evidence.map(
    (e, i) => `${i + 1}. [文档#${e.docId}《${e.title}》片段${e.seq + 1}]\n${previewText(e.text)}`
  );
  return (
    `当前未配置模型密钥，已自动切换为纯检索模式（BM25 多跳，未做 JEV 验证与模型生成）。\n\n` +
    `在知识库中检索到 ${evidence.length} 条候选片段（按 BM25 相关度排序）：\n\n` +
    `${items.join('\n\n')}\n\n` +
    '如需基于这些证据生成整合回答，请点击左下角「设置」配置模型密钥。'
  );
}

// 执行一轮对话：指令直接执行，否则 SAG2 检索 + JEV 后由模型生成
export async function runChatTurn(userId, message, conversationId) {
  let convId = conversationId;
  if (!convId) {
    convId = createConversation(userId, message.trim().slice(0, 30));
  } else if (!conversationOwned(convId, userId)) {
    throw Object.assign(new Error('会话不存在'), { status: 404 });
  }

  const history = getHistory(convId, 10);
  addMessage(convId, 'user', message);

  let type = 'chat';
  let reply;
  let evidence = [];
  try {
    if (isCommand(message)) {
      type = 'command';
      const result = await runCommand(message, userId, { conversationId: convId });
      reply = result.reply;
    } else {
      const cfg = getLlmConfig(userId);
      evidence = await retrieve(message, cfg, userId);
      if (!llmConfigured(cfg)) {
        type = 'retrieval';
        reply = formatRetrievalReply(evidence);
      } else {
        const context = evidence.length
          ? evidence.map((e, i) => `[证据${i + 1}]（文档#${e.docId}《${e.title}》片段${e.seq + 1}）\n${e.text}`).join('\n\n')
          : '（知识库中没有检索到相关内容）';
        const messages = [
          {
            role: 'system',
            content:
              '你是一个知识库聊天机器人。优先基于给出的证据回答问题，并在引用处标注证据编号，如 [证据1]。' +
              '如果证据不足以回答，明确说明知识库中缺少相关内容，再谨慎补充通用知识并标注其为非知识库内容。' +
              '回答使用中文。\n\n=== 检索到的证据（SAG2: BM25 多跳 + JEV 验证）===\n' + context
          },
          ...history,
          { role: 'user', content: message }
        ];
        reply = await chatCompletion(messages, { temperature: 0.4, userId }, cfg);
      }
    }
  } catch (err) {
    logger.error('chat', 'turn failed', { ...userMeta(userId), conversationId: convId, error: err.message });
    touchConversation(convId);
    err.conversationId = convId;
    throw err;
  }

  addMessage(convId, 'assistant', reply, evidence.length ? evidence : null);
  touchConversation(convId);
  logger.info('chat', 'turn ok', { ...userMeta(userId), conversationId: convId, type, evidence: evidence.length });

  return { type, reply, evidence, conversationId: convId };
}
