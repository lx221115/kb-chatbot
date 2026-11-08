import { db } from './db.js';

const ENV_FALLBACK = {
  provider: 'openai',
  baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'deepseek-chat'
};

export function getLlmConfig(userId) {
  const row = userId
    ? db.prepare('SELECT * FROM user_settings WHERE user_id=?').get(userId)
    : null;
  if (row?.api_key) {
    return {
      provider: row.provider || 'openai',
      baseUrl: (row.base_url || (row.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')).replace(/\/$/, ''),
      apiKey: row.api_key,
      model: row.model || (row.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini')
    };
  }
  return ENV_FALLBACK.apiKey ? ENV_FALLBACK : { ...ENV_FALLBACK, apiKey: '' };
}

export function saveLlmConfig(userId, { provider, baseUrl, apiKey, model }) {
  const allowed = ['openai', 'anthropic'];
  const p = allowed.includes(provider) ? provider : 'openai';
  db.prepare(
    `INSERT INTO user_settings(user_id, provider, base_url, api_key, model) VALUES (?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider, base_url=excluded.base_url,
       api_key=excluded.api_key, model=excluded.model`
  ).run(userId, p, (baseUrl || '').trim(), (apiKey || '').trim(), (model || '').trim());
}

export function llmConfigured(cfg) {
  return Boolean(cfg?.apiKey);
}

// OpenAI 兼容协议：DeepSeek / OpenAI / 通义 / Kimi / Ollama 等
async function callOpenai(cfg, messages, { json, temperature }) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Anthropic Messages 协议
async function callAnthropic(cfg, messages, { json, temperature }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const chat = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
  const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      temperature,
      ...(system ? { system } : {}),
      messages: chat
    })
  });
  if (!res.ok) throw new Error(`LLM 请求失败 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (json) return text;
  return text;
}

export async function chatCompletion(messages, opts = {}, cfg = ENV_FALLBACK) {
  if (!llmConfigured(cfg)) throw new Error('未配置模型密钥：请在「设置」中填写，或于服务端 .env 配置 LLM_API_KEY');
  const { json = false, temperature = 0.3 } = opts;
  if (cfg.provider === 'anthropic') return callAnthropic(cfg, messages, { json, temperature });
  return callOpenai(cfg, messages, { json, temperature });
}
