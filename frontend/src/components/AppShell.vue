<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ScrollRail from './ScrollRail.vue';
import SiteFooter from './SiteFooter.vue';
import ThemeToggle from './ThemeToggle.vue';
import ToastStack from './ToastStack.vue';
import { appState, notify } from '../lib/session';

const route = useRoute();
const router = useRouter();
const loggingOut = ref(false);
const pageNav = ref(null);
const navItems = [
  { name: 'dashboard', label: '监控台', caption: 'MONITORS' },
  { name: 'settings', label: '配置', caption: 'SETUP' },
  { name: 'search', label: '号码查询', caption: 'LIVE SEARCH' },
  { name: 'ranking', label: '价格榜', caption: 'RANKING' },
  { name: 'history', label: '本机历史', caption: 'LOCAL ARCHIVE' },
  { name: 'admin', label: '管理', caption: 'ADMIN', admin: true },
];
const visibleNavItems = computed(() => navItems.filter((item) => !item.admin || appState.user?.role === 'admin'));
const initials = computed(() => (appState.user?.name || appState.user?.username || 'L').slice(0, 1).toUpperCase());

watch(() => route.name, async () => {
  await nextTick();
  pageNav.value?.querySelector('.nav-link.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}, { immediate: true });

async function logout() {
  loggingOut.value = true;
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    appState.user = null;
    appState.connected = false;
    appState.monitors = [];
    await router.push({ name: 'login' });
  } catch (error) {
    notify(error.message || '退出失败', 'error');
  } finally { loggingOut.value = false; }
}
</script>

<template>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <header class="topbar">
    <RouterLink class="brand" to="/dashboard" aria-label="FreeSIM Watch 监控台">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span><small>OPEN SOURCE · CLOUDFLARE</small><strong>FreeSIM Watch</strong></span>
    </RouterLink>
    <nav ref="pageNav" class="page-nav" aria-label="主要导航">
      <RouterLink v-for="item in visibleNavItems" :key="item.name" class="nav-link" :to="{ name: item.name }" :class="{ active: route.name === item.name }">{{ item.label }}</RouterLink>
    </nav>
    <div class="topbar-actions">
      <ThemeToggle />
      <div class="user-chip" :title="`LinuxDo @${appState.user?.username}`">
        <img v-if="appState.user?.avatarUrl" :src="appState.user.avatarUrl" alt="" referrerpolicy="no-referrer" />
        <span v-else class="user-avatar" aria-hidden="true">{{ initials }}</span>
        <span><strong>{{ appState.user?.name }}<i v-if="appState.user?.role === 'admin'">管理员</i></strong><small>@{{ appState.user?.username }}</small></span>
      </div>
      <button class="button button-ghost" type="button" :disabled="loggingOut" @click="logout">{{ loggingOut ? '退出中…' : '退出' }}</button>
    </div>
  </header>

  <main id="main" tabindex="-1"><slot /></main>
  <SiteFooter compact />
  <ScrollRail />
  <ToastStack />
</template>
