<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';

const emit = defineEmits(['close']);
const form = ref({ provider: 'openai', baseUrl: '', apiKey: '', model: '' });
const info = ref({ hasKey: false, maskedKey: '', envFallback: false });
const status = ref('');
const saving = ref(false);

const PRESETS = {
  openai: [
    { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' }
  ],
  anthropic: [{ label: 'Anthropic 官方', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' }]
};

onMounted(async () => {
  const s = await api.getSettings();
  info.value = s;
  form.value = { provider: s.provider, baseUrl: s.baseUrl, apiKey: '', model: s.model };
});

function applyPreset(p) {
  form.value.baseUrl = p.baseUrl;
  form.value.model = p.model;
}

async function save() {
  saving.value = true;
  status.value = '';
  try {
    await api.saveSettings(form.value);
    status.value = '已保存';
    setTimeout(() => emit('close'), 500);
  } catch (err) {
    status.value = err.message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="modal">
      <div class="head">
        <h3>模型设置</h3>
        <button class="x" @click="emit('close')">×</button>
      </div>

      <div class="row">
        <label>协议</label>
        <div class="seg">
          <button :class="{ on: form.provider === 'openai' }" @click="form.provider = 'openai'">OpenAI 兼容</button>
          <button :class="{ on: form.provider === 'anthropic' }" @click="form.provider = 'anthropic'">Anthropic</button>
        </div>
      </div>

      <div class="row">
        <label>快捷预设</label>
        <div class="presets">
          <button v-for="p in PRESETS[form.provider]" :key="p.label" @click="applyPreset(p)">{{ p.label }}</button>
        </div>
      </div>

      <div class="row">
        <label>Base URL</label>
        <input v-model="form.baseUrl" :placeholder="form.provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'" />
      </div>
      <div class="row">
        <label>API Key</label>
        <input v-model="form.apiKey" type="password" placeholder="留空则保持原密钥不变（保存时）" />
        <div v-if="info.hasKey" class="note">当前密钥：{{ info.maskedKey }}</div>
        <div v-else-if="info.envFallback" class="note">当前使用服务端 .env 中的密钥</div>
        <div v-else class="note warn">尚未配置密钥，聊天将降级为纯检索（直接返回命中片段，不做整合生成）</div>
      </div>
      <div class="row">
        <label>模型名</label>
        <input v-model="form.model" placeholder="如 deepseek-chat / claude-sonnet-4-5" />
      </div>

      <div class="foot">
        <span class="status">{{ status }}</span>
        <button class="save" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: var(--mask); display: flex; align-items: center; justify-content: center; z-index: 50; }
.modal { width: 440px; max-width: 92vw; background: var(--bg); border-radius: 16px; padding: 20px 24px; box-shadow: var(--shadow-modal); }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
h3 { margin: 0; font-size: 16px; color: var(--text); }
.x { border: none; background: transparent; font-size: 20px; color: var(--text-muted); cursor: pointer; }
.row { margin-bottom: 14px; }
.row label { display: block; font-size: 12.5px; color: var(--text-3); margin-bottom: 6px; }
.seg { display: flex; gap: 4px; background: var(--bg-input); border-radius: 10px; padding: 4px; }
.seg button { flex: 1; border: none; background: transparent; padding: 7px 0; border-radius: 8px; font-size: 13px; color: var(--text-3); cursor: pointer; }
.seg button.on { background: var(--seg-on); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.presets { display: flex; gap: 6px; flex-wrap: wrap; }
.presets button { padding: 5px 12px; border: 1px solid var(--border-strong); background: var(--bg); border-radius: 999px; font-size: 12.5px; color: var(--text-3); cursor: pointer; }
.presets button:hover { border-color: var(--primary); color: var(--primary); }
input { width: 100%; padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; font: inherit; font-size: 13.5px; outline: none; background: var(--bg); color: var(--text); }
input:focus { border-color: var(--primary); }
input::placeholder { color: var(--text-faint); }
.note { font-size: 12px; color: var(--text-muted); margin-top: 5px; }
.note.warn { color: var(--warn); }
.foot { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
.status { font-size: 13px; color: var(--green); }
.save { padding: 8px 26px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-size: 14px; cursor: pointer; }
.save:disabled { opacity: .6; }
</style>
