import { reactive } from 'vue';

export const appState = reactive({
  user: null,
  sessionLoaded: false,
  connected: false,
  monitors: [],
});

export const toastState = reactive({ items: [] });

export async function loadSession(force = false) {
  if (appState.sessionLoaded && !force) return appState.user;
  try {
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    appState.user = response.ok ? data.user || null : null;
  } catch {
    appState.user = null;
  }
  appState.connected = Boolean(appState.user);
  appState.sessionLoaded = true;
  return appState.user;
}

export async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
  const response = await fetch(`/api/${path}`, { ...options, headers, credentials: 'same-origin' });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    appState.user = null;
    appState.connected = false;
    if (window.location.pathname !== '/login') {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?return_to=${encodeURIComponent(returnTo)}`);
    }
  }
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
    error.data = data;
    throw error;
  }
  return data;
}

export function notify(message, type = 'success') {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  toastState.items.push({ id, message, type });
  setTimeout(() => dismissToast(id), type === 'error' ? 7000 : 4500);
}

export function dismissToast(id) {
  const index = toastState.items.findIndex((item) => item.id === id);
  if (index >= 0) toastState.items.splice(index, 1);
}

export function formatDate(value) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—';
}

export function formatMoney(value, currency = 'EUR') {
  if (value == null) return '未知';
  try { return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: currency || 'EUR' }).format(Number(value)); }
  catch { return `${currency || ''} ${Number(value).toFixed(2)}`; }
}
