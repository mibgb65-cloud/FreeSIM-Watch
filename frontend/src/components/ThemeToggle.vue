<script setup>
import { computed } from 'vue';
import { cycleTheme, themeState } from '../lib/theme';

const labels = { system: '跟随系统', light: '浅色', dark: '深色' };
const nextMode = computed(() => ({ system: 'light', light: 'dark', dark: 'system' })[themeState.mode]);
const accessibleLabel = computed(() => `当前主题：${labels[themeState.mode]}。点击切换到${labels[nextMode.value]}模式`);
</script>

<template>
  <button class="theme-toggle" type="button" :aria-label="accessibleLabel" :title="accessibleLabel" @click="cycleTheme">
    <svg v-if="themeState.mode === 'system'" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></svg>
    <svg v-else-if="themeState.mode === 'light'" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
    <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 15.2A8.7 8.7 0 0 1 8.8 3.6 8.8 8.8 0 1 0 20.4 15.2Z"/></svg>
    <span>{{ labels[themeState.mode] }}</span>
  </button>
</template>
