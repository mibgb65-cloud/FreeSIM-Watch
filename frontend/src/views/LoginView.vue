<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ThemeToggle from '../components/ThemeToggle.vue';

const route = useRoute();
const config = ref({ linuxDoConfigured: false, tokenLoginConfigured: false, devLoginEnabled: false });
const configLoaded = ref(false);
const legalConsent = ref(false);
const adminToken = ref('');
const showToken = ref(false);
const submitting = ref('');
const error = computed(() => typeof route.query.error === 'string' ? route.query.error : '');
const returnTo = computed(() => typeof route.query.return_to === 'string' && route.query.return_to.startsWith('/') ? route.query.return_to : '/dashboard');
const loginLead = computed(() => {
  if (config.value.linuxDoConfigured && config.value.tokenLoginConfigured) return '选择 LinuxDo 身份验证，或使用部署时配置的站点 Token 登录。';
  if (config.value.tokenLoginConfigured) return '使用部署时配置的站点 Token 登录。凭据只提交给当前站点，不会保存到页面存储。';
  return '使用 LinuxDo 验证身份。你的监控任务、号码历史和 esim.gg 会话与其他用户完全隔离。';
});

onMounted(async () => {
  try {
    const response = await fetch('/api/auth/config');
    if (response.ok) config.value = await response.json();
  } catch {}
  finally { configLoaded.value = true; }
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
      <p class="login-lead">{{ loginLead }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <label class="legal-consent-card">
        <input v-model="legalConsent" class="choice-native" type="checkbox" />
        <span class="choice-box" aria-hidden="true"></span>
        <span>我已阅读并同意 <RouterLink to="/privacy" target="_blank" @click.stop>隐私政策</RouterLink> 和 <RouterLink to="/terms" target="_blank" @click.stop>服务协议</RouterLink></span>
      </label>
      <form v-if="config.linuxDoConfigured" method="post" action="/auth/linuxdo" @submit="submitting = 'linuxdo'">
        <input type="hidden" name="return_to" :value="returnTo" />
        <input type="hidden" name="legal_consent" :value="legalConsent ? 'accepted' : ''" />
        <button class="button button-primary login-action" type="submit" :disabled="!legalConsent || Boolean(submitting)" :aria-busy="submitting === 'linuxdo'"><span v-if="submitting === 'linuxdo'" class="spinner" aria-hidden="true"></span>{{ submitting === 'linuxdo' ? '正在跳转…' : '使用 LinuxDo 登录' }}</button>
      </form>
      <div v-if="config.linuxDoConfigured && config.tokenLoginConfigured" class="login-divider"><span>或</span></div>
      <form v-if="config.tokenLoginConfigured" class="token-login-form" method="post" action="/auth/token" @submit="submitting = 'token'">
        <input type="hidden" name="return_to" :value="returnTo" />
        <input type="hidden" name="legal_consent" :value="legalConsent ? 'accepted' : ''" />
        <label class="login-token-field" for="admin-token">站点 Token
          <span class="secret-input-row"><input id="admin-token" v-model="adminToken" name="token" :type="showToken ? 'text' : 'password'" required minlength="32" maxlength="256" autocomplete="current-password" spellcheck="false" placeholder="输入部署时配置的 ADMIN_TOKEN" /><button class="button button-ghost" type="button" :aria-pressed="showToken" @click="showToken = !showToken">{{ showToken ? '隐藏' : '显示' }}</button></span>
          <small>仅适合自托管实例；Token 应由密码管理器生成并保存。</small>
        </label>
        <button class="button button-primary login-action" type="submit" :disabled="!legalConsent || Boolean(submitting)" :aria-busy="submitting === 'token'"><span v-if="submitting === 'token'" class="spinner" aria-hidden="true"></span>{{ submitting === 'token' ? '正在登录…' : '使用站点 Token 登录' }}</button>
      </form>
      <a v-if="config.devLoginEnabled" class="button button-secondary login-action" href="/auth/dev">本地开发登录</a>
      <p v-if="configLoaded && !config.linuxDoConfigured && !config.tokenLoginConfigured && !config.devLoginEnabled" class="login-config-warning">站点管理员尚未配置可用的登录方式。</p>
      <small>同意记录将与协议版本一并保存；站点 Token 不会写入浏览器本地存储。</small>
    </section>
  </main>
</template>
