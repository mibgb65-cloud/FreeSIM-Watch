<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ThemeToggle from '../components/ThemeToggle.vue';

const route = useRoute();
const config = ref({ linuxDoConfigured: true, devLoginEnabled: false });
const legalConsent = ref(false);
const submitting = ref(false);
const error = computed(() => typeof route.query.error === 'string' ? route.query.error : '');
const returnTo = computed(() => typeof route.query.return_to === 'string' && route.query.return_to.startsWith('/') ? route.query.return_to : '/dashboard');

onMounted(async () => {
  try {
    const response = await fetch('/api/auth/config');
    if (response.ok) config.value = await response.json();
  } catch {}
});
</script>

<template>
  <main class="login-shell">
    <ThemeToggle class="login-theme-toggle" />
    <section class="login-card panel" aria-labelledby="login-title">
      <RouterLink class="login-brand" to="/" aria-label="FreeSIM Watch">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <strong>FreeSIM Watch</strong>
      </RouterLink>
      <p class="eyebrow">WELCOME BACK</p>
      <h1 id="login-title">账号登录</h1>
      <p class="login-lead">使用 LinuxDo 验证身份。你的监控任务、号码历史和 esim.gg 会话与其他用户完全隔离。</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <form method="post" action="/auth/linuxdo" @submit="submitting = true">
        <input type="hidden" name="return_to" :value="returnTo" />
        <label class="legal-consent-card">
          <input v-model="legalConsent" class="choice-native" type="checkbox" name="legal_consent" value="accepted" required />
          <span class="choice-box" aria-hidden="true"></span>
          <span>我已阅读并同意 <RouterLink to="/privacy" target="_blank" @click.stop>隐私政策</RouterLink> 和 <RouterLink to="/terms" target="_blank" @click.stop>服务协议</RouterLink></span>
        </label>
        <button class="button button-primary login-action" type="submit" :disabled="!config.linuxDoConfigured || !legalConsent || submitting" :aria-busy="submitting"><span v-if="submitting" class="spinner" aria-hidden="true"></span>{{ submitting ? '正在跳转…' : '使用 LinuxDo 登录' }}</button>
      </form>
      <a v-if="config.devLoginEnabled" class="button button-secondary login-action" href="/auth/dev">本地开发登录</a>
      <p v-if="!config.linuxDoConfigured" class="login-config-warning">站点管理员尚未配置 LinuxDo OAuth Client。</p>
      <small>同意记录将与协议版本一并保存。登录后只会读取完成服务所需的 LinuxDo 基础资料。</small>
    </section>
  </main>
</template>
