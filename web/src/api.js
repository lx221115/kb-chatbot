const TOKEN_KEY = 'kb_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(url, options = {}) {
  const token = getToken();
  const isFormData = options.body instanceof FormData;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('kb-unauthorized'));
    throw new Error('登录已失效，请重新登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  register: (username, password) =>
    request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  getConfig: () => request('/api/config'),

  getSettings: () => request('/api/settings'),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  listConversations: () => request('/api/conversations'),
  getConversation: (id) => request(`/api/conversations/${id}`),
  deleteConversation: (id) => request(`/api/conversations/${id}`, { method: 'DELETE' }),
  renameConversation: (id, title) =>
    request(`/api/conversations/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),

  chat: (message, conversationId) =>
    request('/api/chat', { method: 'POST', body: JSON.stringify({ message, conversationId }) }),

  listDocs: () => request('/api/documents'),
  getDoc: (id) => request(`/api/documents/${id}`),
  addText: (title, content) =>
    request('/api/documents', { method: 'POST', body: JSON.stringify({ type: 'text', title, content }) }),
  addUrl: (url) => request('/api/documents', { method: 'POST', body: JSON.stringify({ type: 'url', url }) }),
  addFile: (filename, content) =>
    request('/api/documents', { method: 'POST', body: JSON.stringify({ type: 'file', filename, content }) }),
  uploadDoc: (file) => {
    const form = new FormData();
    form.append('file', file);
    form.append('filename', file.name);
    return request('/api/documents/upload', { method: 'POST', body: form });
  },
  deleteDoc: (id) => request(`/api/documents/${id}`, { method: 'DELETE' }),
  updateChunk: (docId, seq, text) =>
    request(`/api/documents/${docId}/chunks/${seq}`, { method: 'PATCH', body: JSON.stringify({ text }) })
};
