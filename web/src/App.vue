<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { api, clearToken, getToken } from './api.js';
import ChatBox from './components/ChatBox.vue';
import KnowledgeDrawer from './components/KnowledgeDrawer.vue';
import Login from './components/Login.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';

const user = ref(null);
const conversations = ref([]);
const currentId = ref(null);
const showSettings = ref(false);
const kbTab = ref(null);

async function refreshConversations() {
  if (!user.value) return;
  conversations.value = await api.listConversations();
}

async function boot() {
  if (!getToken()) return;
  try {
    user.value = await api.me();
    await refreshConversations();
  } catch {
    user.value = null;
  }
}

function onLogged(session) {
  user.value = { id: session.userId, username: session.username };
  conversations.value = [];
  currentId.value = null;
  refreshConversations();
}

async function onUnauthorized() {
  user.value = null;
}

async function doLogout() {
  try { await api.logout(); } catch {}
  clearToken();
  user.value = null;
  currentId.value = null;
}

function newChat() {
  currentId.value = null;
}

function selectConversation(id) {
  currentId.value = id;
}

function onCreated(id) {
  currentId.value = id;
  refreshConversations();
}

async function deleteConversation(id) {
  if (!confirm('删除该会话？')) return;
  await api.deleteConversation(id);
  if (currentId.value === id) currentId.value = null;
  await refreshConversations();
}

function openKb(tab) {
  kbTab.value = tab || 'list';
}

onMounted(() => {
  boot();
  window.addEventListener('kb-unauthorized', onUnauthorized);
});
onUnmounted(() => window.removeEventListener('kb-unauthorized', onUnauthorized));
</script>

<template>
  <Login v-if="!user" @logged="onLogged" />
  <div v-else class="layout">
    <Sidebar
      :conversations="conversations"
      :current-id="currentId"
      :username="user.username"
      @new="newChat"
      @select="selectConversation"
      @delete="deleteConversation"
      @settings="showSettings = true"
      @logout="doLogout"
      @kb="openKb('list')"
    />
    <main>
      <ChatBox
        :conversation-id="currentId"
        @created="onCreated"
        @changed="refreshConversations"
        @open-kb="openKb"
      />
    </main>
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <KnowledgeDrawer v-if="kbTab" :key="kbTab" :initial-tab="kbTab" @close="kbTab = null" />
  </div>
</template>

<style>
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; }

:root {
  color-scheme: light;
  --bg: #fff;
  --bg-soft: #f9fafb;
  --bg-elev: #f7f8fa;
  --bg-hover: #eef0f3;
  --bg-active: #e8ecfb;
  --bg-input: #f2f3f5;
  --border: #eceef1;
  --border-strong: #e3e6ea;
  --text: #1f2328;
  --text-2: #3b4046;
  --text-3: #57606a;
  --text-muted: #8a919f;
  --text-faint: #b3b9c2;
  --text-fainter: #c3c8d0;
  --primary: #4d6bfe;
  --primary-hover: #3f5ae0;
  --primary-text: #2f4bd8;
  --danger: #d54941;
  --green: #2a9d5c;
  --warn: #b07d2b;
  --mask: rgba(15,20,30,.4);
  --shadow-card: 0 4px 24px rgba(0,0,0,.06);
  --shadow-modal: 0 12px 40px rgba(0,0,0,.18);
  --shadow-composer: 0 2px 12px rgba(0,0,0,.05);
  --seg-on: #fff;
}

[data-theme="dark"] {
  color-scheme: dark;
  --bg: #17181c;
  --bg-soft: #1e2025;
  --bg-elev: #22242a;
  --bg-hover: #2a2c33;
  --bg-active: #2b3350;
  --bg-input: #26282e;
  --border: #2c2e35;
  --border-strong: #3a3d45;
  --text: #e6e8eb;
  --text-2: #c7ccd4;
  --text-3: #9aa1ac;
  --text-muted: #7d848f;
  --text-faint: #5c6169;
  --text-fainter: #4d525a;
  --primary: #5b78ff;
  --primary-hover: #6d86ff;
  --primary-text: #8ea2ff;
  --danger: #f0736c;
  --green: #4cc38a;
  --warn: #d9a441;
  --mask: rgba(0,0,0,.6);
  --shadow-card: 0 4px 24px rgba(0,0,0,.4);
  --shadow-modal: 0 12px 40px rgba(0,0,0,.6);
  --shadow-composer: 0 2px 12px rgba(0,0,0,.3);
  --seg-on: #34373e;
}

body {
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: var(--bg); color: var(--text);
  transition: background .2s ease, color .2s ease;
}
button { font-family: inherit; }
.layout { display: flex; height: 100%; }
.layout main { flex: 1; min-width: 0; height: 100%; }
</style>
