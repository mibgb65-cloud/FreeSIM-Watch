<script setup>
import { computed } from 'vue';
import { appState } from '../lib/session';

defineProps({ compact: Boolean });
const consoleTarget = computed(() => appState.user ? '/dashboard' : '/login?return_to=/dashboard');
</script>

<template>
  <footer class="site-footer" :class="{ compact }">
    <div class="site-footer-inner">
      <div class="footer-brand-block">
        <RouterLink class="brand" to="/" aria-label="FreeSIM Watch 首页">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span><strong>FreeSIM Watch</strong><small>OPEN SOURCE · CLOUDFLARE</small></span>
        </RouterLink>
        <p>持续关注 esim.gg 爱沙尼亚号码池，在发现免费号码时及时通知你。最终购买与付款始终由用户确认。</p>
      </div>

      <nav class="footer-column" aria-label="产品链接">
        <strong>产品</strong>
        <RouterLink to="/">首页</RouterLink>
        <RouterLink :to="consoleTarget">监控台</RouterLink>
        <RouterLink v-if="appState.user" to="/search">号码查询</RouterLink>
        <RouterLink v-if="appState.user" to="/history">本机历史</RouterLink>
      </nav>

      <nav class="footer-column" aria-label="相关服务">
        <strong>相关服务</strong>
        <a href="https://esim.gg" target="_blank" rel="noreferrer">esim.gg</a>
        <a href="https://linux.do" target="_blank" rel="noreferrer">LinuxDo</a>
        <a href="https://developers.cloudflare.com/workers/" target="_blank" rel="noreferrer">Cloudflare Workers</a>
      </nav>

      <nav class="footer-column" aria-label="法律链接">
        <strong>法律与安全</strong>
        <RouterLink to="/privacy">隐私政策</RouterLink>
        <RouterLink to="/terms">服务协议</RouterLink>
        <RouterLink to="/#security">安全设计</RouterLink>
      </nav>
    </div>
    <div class="site-footer-bottom">
      <span>© 2026 FreeSIM Watch</span>
      <span>Powered by Cloudflare Workers · D1 · Resend</span>
      <span>非 esim.gg 官方工具</span>
    </div>
  </footer>
</template>
