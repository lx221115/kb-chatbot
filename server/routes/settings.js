import { Router } from 'express';
import { getLlmConfig, llmConfigured, saveLlmConfig } from '../services/llm.js';

const router = Router();

router.get('/', (req, res) => {
  const cfg = getLlmConfig(req.userId);
  const envCfg = getLlmConfig(null);
  res.json({
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    hasKey: llmConfigured(cfg),
    maskedKey: cfg.apiKey ? cfg.apiKey.slice(0, 4) + '****' + cfg.apiKey.slice(-4) : '',
    envFallback: llmConfigured(envCfg)
  });
});

router.put('/', (req, res) => {
  saveLlmConfig(req.userId, req.body || {});
  res.json({ ok: true });
});

export default router;
