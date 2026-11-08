<script setup>
import { onMounted, ref, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({ initialTab: { type: String, default: 'list' } });
const emit = defineEmits(['close']);

const tab = ref(['url', 'text', 'file'].includes(props.initialTab) ? props.initialTab : 'list');
watch(() => props.initialTab, (t) => { if (['url', 'text', 'file'].includes(t)) tab.value = t; });

const docs = ref([]);
const title = ref('');
const textContent = ref('');
const url = ref('');
const status = ref('');
const busy = ref(false);
const fileRef = ref(null);
const pickedFile = ref(null);
const uploading = ref(false);
const expanded = ref(null);
const detail = ref(null);
const maxUploadMB = ref(100);

async function refresh() {
  docs.value = await api.listDocs();
}
onMounted(async () => {
  refresh();
  try {
    maxUploadMB.value = (await api.getConfig()).maxUploadMB || maxUploadMB.value;
  } catch {
    // 配置接口失败时沿用默认展示，实际上限仍以服务端为准
  }
});

async function ingest() {
  busy.value = true;
  status.value = '';
  try {
    let doc;
    if (tab.value === 'text') {
      if (!textContent.value.trim()) throw new Error('请输入文本内容');
      doc = await api.addText(title.value || textContent.value.slice(0, 30), textContent.value);
    } else {
      if (!url.value.trim()) throw new Error('请输入 URL');
      doc = await api.addUrl(url.value.trim());
    }
    status.value = `已入库：#${doc.id}《${doc.title}》${doc.chunkCount} 片段`;
    title.value = ''; textContent.value = ''; url.value = '';
    await refresh();
  } catch (err) {
    status.value = err.message;
  } finally {
    busy.value = false;
  }
}

function pickFile(e) {
  const file = e.target.files?.[0] || null;
  if (file && file.size > maxUploadMB.value * 1024 * 1024) {
    status.value = `文件超过 ${maxUploadMB.value}MB 上限`;
    pickedFile.value = null;
    e.target.value = '';
    return;
  }
  pickedFile.value = file;
}

async function uploadPicked() {
  if (!pickedFile.value || uploading.value) return;
  uploading.value = true;
  status.value = '';
  try {
    const doc = await api.uploadDoc(pickedFile.value);
    status.value = `已入库：#${doc.id}《${doc.title}》${doc.chunkCount} 片段（${doc.format.toUpperCase()}，${doc.chars} 字）`;
    pickedFile.value = null;
    if (fileRef.value) fileRef.value.value = '';
    await refresh();
  } catch (err) {
    status.value = err.message;
  } finally {
    uploading.value = false;
  }
}

async function toggleDetail(id) {
  if (expanded.value === id) { expanded.value = null; return; }
  expanded.value = id;
  detail.value = await api.getDoc(id);
}

async function remove(id) {
  if (!confirm(`确定删除文档 #${id} 及其全部片段？`)) return;
  await api.deleteDoc(id);
  expanded.value = null;
  await refresh();
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="drawer">
      <div class="head">
        <h3>知识库</h3>
        <button class="x" @click="emit('close')">×</button>
      </div>

      <div class="tabs">
        <button :class="{ on: tab === 'list' }" @click="tab = 'list'">文档（{{ docs.length }}）</button>
        <button :class="{ on: tab === 'file' }" @click="tab = 'file'">上传文件</button>
        <button :class="{ on: tab === 'text' }" @click="tab = 'text'">添加文本</button>
        <button :class="{ on: tab === 'url' }" @click="tab = 'url'">添加链接</button>
      </div>

      <div v-if="tab === 'file'" class="form">
        <input
          ref="fileRef"
          type="file"
          accept=".txt,.md,.markdown,.csv,.log,.json,.docx,.xlsx,.xls,.pptx,.pdf"
          hidden
          @change="pickFile"
        />
        <button class="pick" @click="fileRef.click()">
          {{ pickedFile ? pickedFile.name : '选择文件…' }}
        </button>
        <button class="primary" :disabled="!pickedFile || uploading" @click="uploadPicked">
          {{ uploading ? '解析并入库中…' : '上传并加入知识库' }}
        </button>
        <p class="tip">支持 Word（.docx）、Excel（.xlsx/.xls）、PPT（.pptx）、PDF，以及 .txt/.md/.csv/.json/.log，单个文件 ≤ {{ maxUploadMB }}MB。</p>
      </div>
      <div v-else-if="tab === 'text'" class="form">
        <input v-model="title" placeholder="标题（可选）" />
        <textarea v-model="textContent" rows="8" placeholder="粘贴知识内容…" />
        <button class="primary" :disabled="busy" @click="ingest">{{ busy ? '处理中…' : '加入知识库' }}</button>
      </div>
      <div v-else-if="tab === 'url'" class="form">
        <input v-model="url" placeholder="https://…（自动抓取网页正文）" @keyup.enter="ingest" />
        <button class="primary" :disabled="busy" @click="ingest">{{ busy ? '抓取中…' : '抓取并加入知识库' }}</button>
      </div>

      <div v-if="status" class="status">{{ status }}</div>

      <div v-if="tab === 'list'" class="docs">
        <div v-for="d in docs" :key="d.id" class="doc">
          <div class="doc-head" @click="toggleDetail(d.id)">
            <span class="doc-title">#{{ d.id }} {{ d.title }}</span>
            <span class="doc-meta">{{ d.source_type }} · {{ d.chunk_count }} 片段</span>
          </div>
          <div v-if="expanded === d.id && detail" class="doc-body">
            <div v-if="d.source_ref" class="doc-src">来源：{{ d.source_ref }}</div>
            <pre class="doc-content">{{ detail.chunks.join('\n\n') }}</pre>
            <button class="danger" @click="remove(d.id)">删除此文档</button>
          </div>
        </div>
        <div v-if="!docs.length" class="empty">暂无文档。用上方标签或聊天输入框工具栏添加知识。</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask { position: fixed; inset: 0; background: var(--mask); display: flex; justify-content: flex-end; z-index: 40; }
.drawer { width: 420px; max-width: 94vw; height: 100%; background: var(--bg); padding: 20px 22px; overflow-y: auto; box-shadow: -8px 0 30px rgba(0,0,0,.12); }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
h3 { margin: 0; font-size: 16px; color: var(--text); }
.x { border: none; background: transparent; font-size: 20px; color: var(--text-muted); cursor: pointer; }
.tabs { display: flex; gap: 4px; background: var(--bg-input); border-radius: 10px; padding: 4px; margin-bottom: 14px; }
.tabs button { flex: 1; border: none; background: transparent; padding: 7px 0; border-radius: 8px; font-size: 13px; color: var(--text-3); cursor: pointer; }
.tabs button.on { background: var(--seg-on); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.form { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
input, textarea { padding: 9px 12px; border: 1px solid var(--border-strong); border-radius: 10px; font: inherit; font-size: 13.5px; outline: none; resize: vertical; background: var(--bg); color: var(--text); }
input:focus, textarea:focus { border-color: var(--primary); }
input::placeholder, textarea::placeholder { color: var(--text-faint); }
.primary { padding: 9px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-size: 13.5px; cursor: pointer; }
.primary:disabled { opacity: .6; }
.pick { padding: 10px 12px; border: 1px dashed var(--border-strong); border-radius: 10px; background: var(--bg-elev); color: var(--text-3); font-size: 13px; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick:hover { border-color: var(--primary); color: var(--primary); }
.tip { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--text-muted); }
.status { font-size: 12.5px; color: var(--green); margin-bottom: 10px; }
.docs { display: flex; flex-direction: column; gap: 8px; }
.doc { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.doc-head { padding: 9px 12px; cursor: pointer; display: flex; justify-content: space-between; gap: 8px; }
.doc-head:hover { background: var(--bg-elev); }
.doc-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.doc-meta { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
.doc-body { padding: 10px 12px; border-top: 1px dashed var(--border); }
.doc-src { font-size: 11px; color: var(--text-muted); word-break: break-all; margin-bottom: 4px; }
.doc-content { font-size: 12px; color: var(--text-3); max-height: 220px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; margin: 0 0 8px; }
.danger { padding: 5px 14px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-elev); color: var(--danger); cursor: pointer; font-size: 12.5px; }
.empty { color: var(--text-faint); font-size: 13px; text-align: center; padding: 26px 0; }
</style>
