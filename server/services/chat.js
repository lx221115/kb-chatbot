import { logger } from '../lib/logger.js';
import { userMeta } from '../lib/userMeta.js';
import { HELP_TEXT, isCommand, runCommand } from './commands.js';
import { addMessage, conversationOwned, createConversation, getHistory, touchConversation } from './conversations.js';
import { chatCompletion, getLlmConfig, llmConfigured } from './llm.js';
import { retrieve } from './retrieve.js';

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
      const result = await runCommand(message, userId);
      reply = result.reply;
    } else {
      const cfg = getLlmConfig(userId);
      if (!llmConfigured(cfg)) {
        reply = `尚未配置模型密钥。请点击左下角「设置」填写 API Key（支持 OpenAI 兼容协议与 Anthropic 协议），或在服务端 .env 中配置 LLM_API_KEY。\n\n当前仍可使用指令功能：\n${HELP_TEXT}`;
      } else {
        evidence = await retrieve(message, cfg, userId);
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
