<script setup>
import { ref } from 'vue';
import { api, setToken } from '../api.js';
import { getTheme, toggleTheme } from '../theme.js';

const emit = defineEmits(['logged']);
const mode = ref('login');
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const theme = ref(getTheme());
function onToggleTheme() { theme.value = toggleTheme(); }

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    const session =
      mode.value === 'login'
        ? await api.login(username.value, password.value)
        : await api.register(username.value, password.value);
    setToken(session.token);
    emit('logged', session);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <button class="theme-toggle" @click="onToggleTheme" :title="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'">
      <svg v-if="theme === 'dark'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
    </button>
    <div class="card">
      <img class="logo" src="/logo.svg" alt="KB Chatbot" width="44" height="44" />
      <h1>KB Chatbot</h1>
      <p class="sub">SAG2 知识库聊天机器人</p>

      <div class="tabs">
        <button :class="{ on: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button :class="{ on: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <form @submit.prevent="submit">
        <input v-model="username" placeholder="用户名" autocomplete="username" />
        <input v-model="password" type="password" placeholder="密码（至少 6 位）" autocomplete="current-password" @keyup.enter="submit" />
        <div v-if="error" class="error">{{ error }}</div>
        <button class="primary" type="submit" :disabled="busy">
          {{ busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page { height: 100%; display: flex; align-items: center; justify-content: center; background: var(--bg-elev); }
.theme-toggle {
  position: fixed; top: 18px; right: 20px; width: 38px; height: 38px; border-radius: 10px;
  border: 1px solid var(--border-strong); background: var(--bg); color: var(--text-3);
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.theme-toggle:hover { color: var(--primary); border-color: var(--primary); }
.card { width: 340px; padding: 36px 32px; background: var(--bg); border-radius: 16px; box-shadow: var(--shadow-card); text-align: center; }
.logo { display: block; width: 44px; height: 44px; margin: 0 auto 10px; }
h1 { font-size: 20px; margin: 0; color: var(--text); }
.sub { color: var(--text-muted); font-size: 13px; margin: 6px 0 22px; }
.tabs { display: flex; gap: 4px; background: var(--bg-input); border-radius: 10px; padding: 4px; margin-bottom: 16px; }
.tabs button { flex: 1; border: none; background: transparent; padding: 7px 0; border-radius: 8px; font-size: 14px; color: var(--text-3); cursor: pointer; }
.tabs button.on { background: var(--seg-on); color: var(--text); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
form { display: flex; flex-direction: column; gap: 12px; }
input { padding: 10px 14px; border: 1px solid var(--border-strong); border-radius: 10px; font: inherit; font-size: 14px; outline: none; background: var(--bg); color: var(--text); }
input:focus { border-color: var(--primary); }
input::placeholder { color: var(--text-faint); }
.error { color: var(--danger); font-size: 13px; text-align: left; }
.primary { padding: 10px; border: none; border-radius: 10px; background: var(--primary); color: #fff; font-size: 14px; cursor: pointer; }
.primary:disabled { opacity: .6; cursor: not-allowed; }
</style>
