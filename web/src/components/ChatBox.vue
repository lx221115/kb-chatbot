<script setup>
import { nextTick, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({ conversationId: { type: Number, default: null } });
const emit = defineEmits(['created', 'changed', 'open-kb']);

const messages = ref([]);
const input = ref('');
const busy = ref(false);
const listRef = ref(null);
const fileRef = ref(null);

const SUGGESTIONS = ['/知识库列表', '/添加知识库 今天天气适合阅读', '/帮助'];

watch(
  () => props.conversationId,
  async (id) => {
    if (!id) { messages.value = []; return; }
    const conv = await api.getConversation(id);
    messages.value = conv.messages;
    await scrollBottom(false);
  },
  { immediate: true }
);

async function scrollBottom(smooth = true) {
  await nextTick();
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

async function send(text) {
  const message = (text ?? input.value).trim();
  if (!message || busy.value) return;
  input.value = '';
  messages.value.push({ role: 'user', content: message });
  busy.value = true;
  await scrollBottom();
  try {
    const data = await api.chat(message, props.conversationId);
    if (data.conversationId !== props.conversationId) emit('created', data.conversationId);
    messages.value.push({ role: 'assistant', content: data.reply, evidence: data.evidence });
    emit('changed');
  } catch (err) {
    messages.value.push({ role: 'assistant', content: `出错了：${err.message}` });
  } finally {
    busy.value = false;
    await scrollBottom();
  }
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

async function onFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    const doc = await api.addFile(file.name, content);
    messages.value.push({ role: 'assistant', content: `文件《${file.name}》已加入知识库（文档 #${doc.id}，${doc.chunkCount} 个片段）。` });
    emit('changed');
  } catch (err) {
    messages.value.push({ role: 'assistant', content: `文件入库失败：${err.message}` });
  } finally {
    e.target.value = '';
    await scrollBottom();
  }
}

function autoGrow(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
}
</script>

<template>
  <div class="chat">
    <div ref="listRef" class="msg-list">
      <div v-if="!messages.length" class="welcome">
        <div class="w-logo">KB</div>
        <h2>你好，有什么可以帮你？</h2>
        <p>基于你的知识库回答（SAG2：BM25 多跳检索 + JEV 证据验证）</p>
        <div class="sugs">
          <button v-for="s in SUGGESTIONS" :key="s" @click="send(s)">{{ s }}</button>
        </div>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <div v-if="m.role === 'assistant'" class="a-avatar">KB</div>
        <div class="body">
          <pre class="content">{{ m.content }}</pre>
          <details v-if="m.evidence?.length" class="evidence">
            <summary>{{ m.evidence.length }} 条引用证据</summary>
            <div v-for="(e, j) in m.evidence" :key="j" class="ev-item">
              <div class="ev-title">
                #{{ e.docId }}《{{ e.title }}》片段{{ e.seq + 1 }}
                <span v-if="e.jevScore != null" class="ev-score">JEV {{ e.jevScore }}/10</span>
              </div>
              <div class="ev-text">{{ e.text.slice(0, 240) }}…</div>
            </div>
          </details>
        </div>
      </div>
      <div v-if="busy" class="msg assistant">
        <div class="a-avatar">KB</div>
        <div class="body typing">思考中…</div>
      </div>
    </div>

    <div class="composer-wrap">
      <div class="composer">
        <div class="toolbar">
          <button class="tool" title="上传文件（.txt/.md/.csv/.json/.log）" @click="fileRef.click()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg>
            文件
          </button>
          <button class="tool" title="抓取网页加入知识库" @click="emit('open-kb', 'url')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            链接
          </button>
          <button class="tool" title="粘贴文本加入知识库" @click="emit('open-kb', 'text')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
            文本
          </button>
          <button class="tool" title="查看/管理知识库" @click="emit('open-kb', 'list')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/></svg>
            知识库
          </button>
          <span class="hint">/ 开头为知识库指令</span>
        </div>
        <textarea
          ref="taRef"
          v-model="input"
          rows="1"
          placeholder="发消息…（Enter 发送，Shift+Enter 换行）"
          @keydown="onKeydown"
          @input="autoGrow"
        />
        <div class="composer-bottom">
          <span class="powered">SAG2 · SQLite FTS5 + BM25 + JEV</span>
          <button class="send" :disabled="busy || !input.trim()" @click="send()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
          </button>
        </div>
      </div>
      <input ref="fileRef" type="file" accept=".txt,.md,.markdown,.csv,.log,.json" hidden @change="onFile" />
    </div>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
.msg-list { flex: 1; overflow-y: auto; padding: 28px 20px 12px; }
.msg-list > * { max-width: 760px; margin: 0 auto 22px; }
.welcome { text-align: center; padding-top: 12vh; }
.w-logo {
  width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 14px; background: var(--primary);
  color: #fff; font-weight: 700; font-size: 20px; display: flex; align-items: center; justify-content: center;
}
.welcome h2 { font-size: 22px; margin: 0 0 6px; font-weight: 600; color: var(--text); }
.welcome p { color: var(--text-muted); font-size: 13.5px; margin: 0 0 22px; }
.sugs { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.sugs button {
  padding: 7px 14px; border: 1px solid var(--border-strong); background: var(--bg); border-radius: 999px;
  font-size: 13px; color: var(--text-3); cursor: pointer;
}
.sugs button:hover { border-color: var(--primary); color: var(--primary); }
.msg { display: flex; gap: 12px; }
.msg.user { justify-content: flex-end; }
.a-avatar {
  width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px; background: var(--primary); color: #fff;
  font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; margin-top: 2px;
}
.msg .body { max-width: 82%; min-width: 0; }
.msg.user .body {
  background: var(--bg-input); border-radius: 14px; padding: 10px 16px;
}
.content { white-space: pre-wrap; word-break: break-word; font: inherit; font-size: 14.5px; line-height: 1.7; margin: 0; color: var(--text); }
.typing { color: var(--text-muted); font-size: 14px; }
.evidence { margin-top: 10px; font-size: 12.5px; }
.evidence summary { cursor: pointer; color: var(--primary); }
.ev-item { margin: 6px 0; padding: 8px 10px; background: var(--bg-elev); border-radius: 8px; }
.ev-title { font-weight: 600; color: var(--text-2); }
.ev-score { margin-left: 6px; color: var(--green); font-weight: 400; }
.ev-text { color: var(--text-3); margin-top: 2px; }
.composer-wrap { padding: 0 20px 18px; }
.composer {
  max-width: 760px; margin: 0 auto; background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: 16px; box-shadow: var(--shadow-composer); padding: 10px 14px 8px;
}
.toolbar { display: flex; align-items: center; gap: 4px; padding-bottom: 6px; }
.tool {
  display: flex; align-items: center; gap: 5px; border: none; background: transparent;
  padding: 5px 9px; border-radius: 8px; font-size: 12.5px; color: var(--text-3); cursor: pointer;
}
.tool:hover { background: var(--bg-hover); color: var(--text); }
.hint { margin-left: auto; font-size: 11.5px; color: var(--text-faint); }
.composer textarea {
  width: 100%; border: none; outline: none; resize: none; font: inherit; font-size: 14.5px;
  line-height: 1.6; padding: 2px 2px 6px; max-height: 180px; background: transparent; color: var(--text);
}
.composer textarea::placeholder { color: var(--text-faint); }
.composer-bottom { display: flex; align-items: center; justify-content: space-between; }
.powered { font-size: 11px; color: var(--text-fainter); }
.send {
  width: 32px; height: 32px; border: none; border-radius: 50%; background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.send:disabled { background: var(--bg-hover); color: var(--text-faint); cursor: not-allowed; }
</style>
