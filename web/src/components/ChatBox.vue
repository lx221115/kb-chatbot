<script setup>
import { nextTick, onMounted, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({ conversationId: { type: Number, default: null } });
const emit = defineEmits(['created', 'changed', 'open-kb']);

const messages = ref([]);
const input = ref('');
const busy = ref(false);
const uploading = ref(false);
const listRef = ref(null);
const fileRef = ref(null);
const editing = ref(null);
const editText = ref('');
const saving = ref(false);
const maxUploadMB = ref(100);

onMounted(async () => {
  try {
    maxUploadMB.value = (await api.getConfig()).maxUploadMB || maxUploadMB.value;
  } catch {
    // 配置接口失败时沿用默认展示，实际上限仍以服务端为准
  }
});

const SUGGESTIONS = ['/知识库列表', '/添加知识库 今天天气适合阅读', '/帮助'];

watch(
  () => props.conversationId,
  async (id) => {
    editing.value = null;
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

function startEdit(e) {
  editing.value = { docId: e.docId, seq: e.seq };
  editText.value = e.text;
}

function cancelEdit() {
  editing.value = null;
  editText.value = '';
}

async function saveEdit() {
  if (!editing.value || saving.value) return;
  const { docId, seq } = editing.value;
  const text = editText.value.trim();
  if (!text) return;
  saving.value = true;
  try {
    const updated = await api.updateChunk(docId, seq + 1, text);
    const target = messages.value
      .flatMap((m) => m.evidence || [])
      .find((e) => e.docId === docId && e.seq === seq);
    if (target) target.text = updated.text;
    messages.value.push({ role: 'assistant', content: `已修正 文档#${docId} 片段${seq + 1}，下次问答将按新内容检索。` });
    emit('changed');
    cancelEdit();
  } catch (err) {
    messages.value.push({ role: 'assistant', content: `修正失败：${err.message}` });
  } finally {
    saving.value = false;
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
  if (file.size > maxUploadMB.value * 1024 * 1024) {
    messages.value.push({ role: 'assistant', content: `文件超过 ${maxUploadMB.value}MB 上限` });
    e.target.value = '';
    await scrollBottom();
    return;
  }
  uploading.value = true;
  try {
    const doc = await api.uploadDoc(file);
    messages.value.push({ role: 'assistant', content: `文件《${file.name}》已加入知识库（文档 #${doc.id}，${doc.chunkCount} 个片段）。` });
    emit('changed');
  } catch (err) {
    messages.value.push({ role: 'assistant', content: `文件入库失败：${err.message}` });
  } finally {
    uploading.value = false;
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
        <img class="w-logo" src="/logo.svg" alt="" width="52" height="52" />
        <h2>你好，有什么可以帮你？</h2>
        <p>基于你的知识库回答（SAG2：BM25 多跳检索 + JEV 证据验证）</p>
        <div class="sugs">
          <button v-for="s in SUGGESTIONS" :key="s" @click="send(s)">{{ s }}</button>
        </div>
      </div>

      <div v-for="(m, i) in messages" :key="i" class="msg" :class="m.role">
        <img v-if="m.role === 'assistant'" class="a-avatar" src="/logo.svg" alt="" width="30" height="30" />
        <div class="body">
          <pre class="content">{{ m.content }}</pre>
          <details v-if="m.evidence?.length" class="evidence">
            <summary>{{ m.evidence.length }} 条引用证据</summary>
            <div v-for="(e, j) in m.evidence" :key="j" class="ev-item">
              <div class="ev-title">
                #{{ e.docId }}《{{ e.title }}》片段{{ e.seq + 1 }}
                <span v-if="e.jevScore != null" class="ev-score">JEV {{ e.jevScore }}/10</span>
                <button class="ev-edit" @click.stop="startEdit(e)">修正</button>
              </div>
              <div v-if="editing && editing.docId === e.docId && editing.seq === e.seq" class="ev-editor">
                <textarea v-model="editText" rows="4" />
                <div class="ev-actions">
                  <button :disabled="saving || !editText.trim()" @click="saveEdit">保存</button>
                  <button :disabled="saving" @click="cancelEdit">取消</button>
                </div>
              </div>
              <div v-else class="ev-text">{{ e.text.slice(0, 240) }}…</div>
            </div>
          </details>
        </div>
      </div>
      <div v-if="busy" class="msg assistant">
        <img class="a-avatar" src="/logo.svg" alt="" width="30" height="30" />
        <div class="body typing">思考中…</div>
      </div>
    </div>

    <div class="composer-wrap">
      <div class="composer">
        <div class="toolbar">
          <button class="tool" :disabled="uploading" :title="`上传文件（Word / Excel / PPT / PDF / 文本，≤${maxUploadMB}MB）`" @click="fileRef.click()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.4 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.49-8.48"/></svg>
            {{ uploading ? '解析中…' : '文件' }}
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
      <input ref="fileRef" type="file" accept=".txt,.md,.markdown,.csv,.log,.json,.docx,.xlsx,.xls,.pptx,.pdf" hidden @change="onFile" />
    </div>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--bg); }
.msg-list { flex: 1; overflow-y: auto; padding: 28px 20px 12px; }
.msg-list > * { max-width: 760px; margin: 0 auto 22px; }
.welcome { text-align: center; padding-top: 12vh; }
.w-logo { display: block; width: 52px; height: 52px; margin: 0 auto 14px; }
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
  display: block; width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px; margin-top: 2px;
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
.ev-edit {
  margin-left: 8px; border: none; background: transparent; color: var(--primary);
  font-size: 12px; cursor: pointer; padding: 0 2px;
}
.ev-editor { margin-top: 6px; }
.ev-editor textarea {
  width: 100%; box-sizing: border-box; resize: vertical; font: inherit; font-size: 12.5px;
  line-height: 1.6; color: var(--text); background: var(--bg-input);
  border: 1px solid var(--border-strong); border-radius: 6px; padding: 6px 8px;
}
.ev-actions { display: flex; gap: 6px; margin-top: 6px; }
.ev-actions button {
  border: 1px solid var(--border-strong); background: var(--bg); color: var(--text-2);
  border-radius: 6px; padding: 3px 10px; font-size: 12px; cursor: pointer;
}
.ev-actions button:first-child { background: var(--primary); border-color: var(--primary); color: #fff; }
.ev-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
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
.tool:disabled { opacity: .5; cursor: not-allowed; }
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
