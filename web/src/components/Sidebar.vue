<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { getTheme, toggleTheme } from '../theme.js';
defineProps({
  conversations: { type: Array, default: () => [] },
  currentId: { type: Number, default: null },
  username: { type: String, default: '' }
});
const emit = defineEmits(['new', 'select', 'delete', 'settings', 'logout', 'kb']);
const theme = ref(getTheme());
function onToggleTheme() { theme.value = toggleTheme(); }

const now = ref(Date.now());
let ticker;
onMounted(() => {
  ticker = setInterval(() => { now.value = Date.now(); }, 60_000);
});
onUnmounted(() => clearInterval(ticker));

function parseTime(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fullTime(value) {
  const d = parseTime(value);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function timeLabel(value) {
  const d = parseTime(value);
  if (!d) return '';
  const stamp = now.value;
  const todayStart = new Date(new Date(stamp).setHours(0, 0, 0, 0)).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const p = (n) => String(n).padStart(2, '0');
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (stamp - d.getTime() < 60_000) return '刚刚';
  if (d.getTime() >= todayStart) return hm;
  if (d.getTime() >= todayStart - dayMs) return `昨天 ${hm}`;
  if (d.getFullYear() === new Date(stamp).getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
</script>

<template>
  <aside class="sidebar">
    <div class="top">
      <div class="brand">
        <img class="logo" src="/logo.svg" alt="" width="26" height="26" />
        <span>KB Chatbot</span>
      </div>
      <button class="new-chat" @click="emit('new')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>
        新会话
      </button>
    </div>

    <div class="hist">
      <div class="hist-title">历史会话</div>
      <div
        v-for="c in conversations"
        :key="c.id"
        class="item"
        :class="{ on: c.id === currentId }"
        @click="emit('select', c.id)"
      >
        <span class="item-body">
          <span class="item-title">{{ c.title }}</span>
          <span class="item-time" :title="fullTime(c.updated_at)">{{ timeLabel(c.updated_at) }}</span>
        </span>
        <button class="del" title="删除会话" @click.stop="emit('delete', c.id)">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
        </button>
      </div>
      <div v-if="!conversations.length" class="empty">暂无会话</div>
    </div>

    <div class="bottom">
      <button class="link" @click="emit('kb')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>
        知识库管理
      </button>
      <button class="link" @click="emit('settings')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
        模型设置
      </button>
      <button class="link" @click="onToggleTheme" :title="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'">
        <svg v-if="theme === 'dark'" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
        {{ theme === 'dark' ? '浅色模式' : '深色模式' }}
      </button>
      <div class="user-row">
        <span class="avatar">{{ username.slice(0, 1).toUpperCase() }}</span>
        <span class="uname">{{ username }}</span>
        <button class="link logout" title="退出登录" @click="emit('logout')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 250px; flex-shrink: 0; display: flex; flex-direction: column;
  background: var(--bg-soft); border-right: 1px solid var(--border); height: 100%;
}
.top { padding: 16px 14px 10px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; margin-bottom: 14px; }
.logo { width: 26px; height: 26px; flex-shrink: 0; display: block; }
.new-chat {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 0; border: none; border-radius: 10px; background: var(--primary);
  color: #fff; font-size: 14px; cursor: pointer;
}
.new-chat:hover { background: var(--primary-hover); }
.hist { flex: 1; overflow-y: auto; padding: 6px 8px; }
.hist-title { font-size: 12px; color: var(--text-muted); padding: 6px 8px; }
.item {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13.5px; color: var(--text-2);
}
.item:hover { background: var(--bg-hover); }
.item.on { background: var(--bg-active); color: var(--primary-text); font-weight: 600; }
.item-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.item-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-time { font-size: 11.5px; font-weight: 400; color: var(--text-faint); line-height: 1.2; }
.item.on .item-time { color: var(--primary-text); opacity: .72; }
.del { border: none; background: transparent; color: var(--text-faint); cursor: pointer; padding: 2px; border-radius: 4px; visibility: hidden; }
.item:hover .del { visibility: visible; }
.del:hover { color: var(--danger); }
.empty { color: var(--text-faint); font-size: 12.5px; text-align: center; padding: 18px 0; }
.bottom { border-top: 1px solid var(--border); padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 4px; }
.link {
  display: flex; align-items: center; gap: 8px; border: none; background: transparent;
  padding: 7px 8px; border-radius: 8px; font-size: 13.5px; color: var(--text-3); cursor: pointer; text-align: left;
}
.link:hover { background: var(--bg-hover); color: var(--text); }
.user-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.avatar {
  width: 26px; height: 26px; border-radius: 50%; background: var(--bg-active); color: var(--primary-text);
  font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.uname { flex: 1; font-size: 13.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; }
.logout { padding: 4px; }
</style>
