import { computed, reactive } from 'vue';

const STORAGE_KEY = 'freesim-watch-theme';
const MODES = ['system', 'light', 'dark'];
const media = window.matchMedia('(prefers-color-scheme: dark)');

function storedMode() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export const themeState = reactive({ mode: storedMode(), systemDark: media.matches });
export const resolvedTheme = computed(() => themeState.mode === 'system' ? (themeState.systemDark ? 'dark' : 'light') : themeState.mode);

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme.value;
  document.documentElement.dataset.themeMode = themeState.mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme.value === 'dark' ? '#0d0d0f' : '#ffffff');
}

export function initTheme() {
  applyTheme();
  media.addEventListener('change', (event) => {
    themeState.systemDark = event.matches;
    if (themeState.mode === 'system') applyTheme();
  });
}

export function cycleTheme() {
  themeState.mode = MODES[(MODES.indexOf(themeState.mode) + 1) % MODES.length];
  try { localStorage.setItem(STORAGE_KEY, themeState.mode); } catch {}
  applyTheme();
}
