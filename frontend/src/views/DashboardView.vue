<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import MetricCard from '../components/MetricCard.vue';
import ManualOrderDialog from '../components/ManualOrderDialog.vue';
import PageHero from '../components/PageHero.vue';
import StatusBadge from '../components/StatusBadge.vue';
import UiSelect from '../components/UiSelect.vue';
import { deleteLocalCheckHistoryForMonitor, saveLocalCheckRun } from '../lib/history';
import { couponFromAction } from '../lib/order';
import { api, appState, formatDate, formatMoney, notify } from '../lib/session';

const monitors = computed(() => appState.monitors);
const route = useRoute();
const router = useRouter();
const isSettingsPage = computed(() => route.name === 'settings');
const discoveries = ref([]);
const loading = ref(false);
const saving = ref(false);
const checkingId = ref('');
const inlineMonitorId = ref('');
const editor = ref(null);
const deleteDialog = ref(null);
const deleteTarget = ref(null);
const deletingId = ref('');
const manualOrderTarget = ref(null);
const creatingManualOrder = ref(false);
const providerAccounts = ref([]);
const providerStatusLoaded = ref(false);
const sessionConfigured = computed(() => providerAccounts.value.some((account) => account.configured));
const accountOptions = computed(() => [
  { value: '', label: providerAccounts.value.length ? '选择用于监控的 esim.gg 账号' : '请先绑定 esim.gg 账号', disabled: true },
  ...providerAccounts.value.map((account) => ({
    value: account.id,
    label: `${account.label}${account.configured ? '' : '（会话已过期）'}`,
    disabled: !account.configured,
  })),
]);
const accountLabel = ref('');
const editingAccountId = ref('');
const importCode = ref('');
const importExpiresAt = ref(null);
const generatingCode = ref(false);
const manualSession = ref('');
const importingSession = ref(false);
const showManualSession = ref(false);
const showSessionImporter = ref(false);
let importPollTimer = 0;
const form = reactive(defaultForm());
const importCommand = computed(() => importCode.value
  ? `npm run esimgg:session -- --server ${window.location.origin} --code ${importCode.value}`
  : '');

function defaultForm() {
  return {
    id: '', providerSessionId: '', name: 'esim.gg Estonia 号码监控', notifyEmail: '', url: 'https://api.esim.gg/api/number/search', method: 'POST', intervalMinutes: 1,
    checkRounds: 3, roundDelaySeconds: 1,
    headersText: JSON.stringify({ 'content-type': 'application/json', cookie: '__Secure-nekopass.session_token={{secret:ESIMGG_SESSION_TOKEN}}', origin: 'https://esim.gg', referer: 'https://esim.gg/new/number/estonia' }, null, 2),
    body: JSON.stringify({ search: '', type: 'global' }), format: 'json', itemsPath: 'search', numberPath: 'msisdn', pricePath: 'price',
    priceSubtract: 0.2, currencyPath: '', currencyValue: 'EUR', purchaseUrlPath: '', numberRegex: '', priceRegex: '', purchaseUrlRegex: '',
    currency: 'EUR', numberPrefix: '372', maxPrice: 0, enabled: true, actionEnabled: true,
    actionUrl: 'https://api.esim.gg/api/checkout/create', actionMethod: 'POST',
    actionHeadersText: JSON.stringify({ 'content-type': 'application/json', cookie: '__Secure-nekopass.session_token={{secret:ESIMGG_SESSION_TOKEN}}', origin: 'https://esim.gg', referer: 'https://esim.gg/new/number/estonia' }, null, 2),
    actionBody: JSON.stringify({ order_type: 'new_line', msisdn: '{{number}}', payment_method: 'alipay', recharge_amount: 1, coupon: 'setup', validity_addon: 'none', data_package: 'none', metadata: {} }, null, 2),
    paymentUrlPath: 'redirect_url', orderIdPath: '', totalPath: 'total_price', actionCurrencyPath: '', maxCandidatePrice: 0, rechargeAmount: 1, coupon: 'setup',
    maxOrdersPerCheck: 1, cooldownMinutes: 30, disableAfterOrder: true, actionAcknowledged: true,
  };
}

function resetForm() {
  const notifyEmail = form.notifyEmail;
  Object.assign(form, defaultForm(), { notifyEmail });
}
function parseObject(text, label) {
  if (!text.trim()) return {};
  try { const value = JSON.parse(text); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { throw new Error(`${label}必须是有效的 JSON 对象`); }
}

function payload() {
  const parser = {
    format: form.format,
    itemsPath: form.itemsPath || undefined,
    numberPath: form.numberPath || undefined,
    pricePath: form.pricePath || undefined,
    priceSubtract: Number(form.priceSubtract) || 0,
    currencyPath: form.currencyPath || undefined,
    currencyValue: form.currencyValue || undefined,
    purchaseUrlPath: form.purchaseUrlPath || undefined,
    numberRegex: form.format === 'text' ? form.numberRegex || undefined : undefined,
    priceRegex: form.format === 'text' ? form.priceRegex || undefined : undefined,
    purchaseUrlRegex: form.format === 'text' ? form.purchaseUrlRegex || undefined : undefined,
  };
  const maxCandidatePrice = Number(form.maxCandidatePrice) || 0;
  const action = form.actionEnabled ? {
    enabled: true, url: form.actionUrl, method: form.actionMethod,
    headers: parseObject(form.actionHeadersText, '下单请求头'), bodyTemplate: form.actionBody,
    paymentUrlPath: form.paymentUrlPath, orderIdPath: form.orderIdPath || undefined,
    totalPath: form.totalPath || undefined, currencyPath: form.actionCurrencyPath || undefined,
    maxCandidatePrice, rechargeAmount: Number(form.rechargeAmount), coupon: form.coupon,
    maxOrdersPerCheck: Number(form.maxOrdersPerCheck),
    cooldownMinutes: Number(form.cooldownMinutes), disableMonitorAfterOrder: form.disableAfterOrder,
    unpaidOnlyAcknowledged: form.actionAcknowledged,
  } : null;
  return {
    providerSessionId: form.providerSessionId, name: form.name.trim(), notifyEmail: form.notifyEmail.trim(), url: form.url.trim(), method: form.method,
    intervalMinutes: Number(form.intervalMinutes), headers: parseObject(form.headersText, '请求头'), body: form.body.trim() || null,
    parser, filters: { freeOnly: form.actionEnabled ? maxCandidatePrice <= 0 : true, maxPrice: form.actionEnabled ? maxCandidatePrice : Number(form.maxPrice), currency: form.currency.trim() || undefined, numberPrefix: form.numberPrefix.trim() || undefined, checkRounds: Number(form.checkRounds), roundDelaySeconds: Number(form.roundDelaySeconds) },
    action, enabled: form.enabled,
  };
}

function editMonitor(monitor) {
  const filters = monitor.filters || {};
  Object.assign(form, defaultForm(), {
    id: monitor.id,
    providerSessionId: monitor.providerSessionId || '',
    name: monitor.name,
    notifyEmail: monitor.notifyEmail,
    checkRounds: filters.checkRounds ?? 3,
    roundDelaySeconds: filters.roundDelaySeconds ?? 1,
    enabled: monitor.enabled,
    actionEnabled: Boolean(monitor.action?.enabled),
    maxCandidatePrice: monitor.action?.maxCandidatePrice ?? 0,
    rechargeAmount: monitor.action?.rechargeAmount ?? rechargeAmountFromBody(monitor.action?.bodyTemplate),
    coupon: couponFromAction(monitor.action),
    actionAcknowledged: monitor.action?.unpaidOnlyAcknowledged ?? true,
  });
  nextTick(() => editor.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function rechargeAmountFromBody(bodyTemplate) {
  try {
    const amount = Number(JSON.parse(bodyTemplate || '{}').recharge_amount);
    return Number.isFinite(amount) && amount >= 0.02 ? amount : 1;
  } catch {
    return 1;
  }
}

function applyPreset() {
  const id = form.id;
  const email = form.notifyEmail;
  const providerSessionId = form.providerSessionId;
  Object.assign(form, defaultForm(), { id, notifyEmail: email, providerSessionId });
  notify('已恢复 esim.gg 推荐参数。');
}

function openNewMonitor() {
  resetForm();
  router.push({ name: 'settings' });
}

function openMonitorEditor(monitor) {
  inlineMonitorId.value = monitor.id;
  editMonitor(monitor);
}

function closeInlineEditor() {
  inlineMonitorId.value = '';
  resetForm();
}

async function refresh() {
  if (!appState.user) return;
  loading.value = true;
  try {
    const [{ monitors: loadedMonitors }, { discoveries: loadedDiscoveries }, session] = await Promise.all([api('monitors'), api('discoveries?limit=100'), api('esimgg/status')]);
    appState.monitors = loadedMonitors;
    discoveries.value = loadedDiscoveries;
    applyProviderStatus(session);
    appState.connected = true;
  } catch (error) { appState.connected = false; notify(error.message, 'error'); }
  finally { loading.value = false; }
}

function applyProviderStatus(session) {
  providerAccounts.value = session.accounts || [];
  providerStatusLoaded.value = true;
  const fallback = providerAccounts.value[0];
  if (fallback) {
    appState.monitors = appState.monitors.map((monitor) => monitor.providerSessionId
      ? monitor
      : { ...monitor, providerSessionId: fallback.id, providerSessionLabel: fallback.label });
  }
  if (!providerAccounts.value.some((account) => account.id === form.providerSessionId && account.configured)) {
    form.providerSessionId = providerAccounts.value.find((account) => account.configured)?.id || '';
  }
}

function accountSignature(accounts = providerAccounts.value) {
  return accounts.map((account) => `${account.id}:${account.updatedAt}`).join('|');
}

function addProviderAccount() {
  editingAccountId.value = '';
  accountLabel.value = `esim.gg 账号 ${providerAccounts.value.length + 1}`;
  manualSession.value = '';
  showSessionImporter.value = true;
}

function updateProviderAccount(account) {
  editingAccountId.value = account.id;
  accountLabel.value = account.label;
  manualSession.value = '';
  showSessionImporter.value = true;
}

function closeSessionImporter() {
  showSessionImporter.value = false;
  editingAccountId.value = '';
  accountLabel.value = '';
  manualSession.value = '';
  importCode.value = '';
  window.clearInterval(importPollTimer);
  importPollTimer = 0;
}

async function removeProviderAccount(account) {
  if (!confirm(`确定解绑“${account.label}”吗？保存的加密会话将被删除。`)) return;
  try {
    const result = await api(`esimgg/session/${account.id}`, { method: 'DELETE' });
    applyProviderStatus(result);
    notify('esim.gg 账号已解绑。');
  } catch (error) { notify(error.message, 'error'); }
}

async function pollImportedSession(previousSignature) {
  try {
    const session = await api('esimgg/status');
    applyProviderStatus(session);
    if (session.configured && accountSignature(session.accounts || []) !== previousSignature) {
      window.clearInterval(importPollTimer);
      importPollTimer = 0;
      importCode.value = '';
      closeSessionImporter();
      notify('esim.gg 账号会话已安全导入。');
    }
  } catch {}
}

async function generateImportCode() {
  if (!accountLabel.value.trim()) { notify('请先填写账号备注。', 'error'); return; }
  generatingCode.value = true;
  try {
    const previousSignature = accountSignature();
    const result = await api('esimgg/import-code', { method: 'POST', body: JSON.stringify({ label: accountLabel.value, accountId: editingAccountId.value || null }) });
    importCode.value = result.code;
    importExpiresAt.value = result.expiresAt;
    window.clearInterval(importPollTimer);
    importPollTimer = window.setInterval(() => pollImportedSession(previousSignature), 3000);
    notify('一次性导入码已生成，10 分钟内有效。');
  } catch (error) { notify(error.message, 'error'); }
  finally { generatingCode.value = false; }
}

async function importSessionFromWeb() {
  if (!accountLabel.value.trim()) { notify('请填写账号备注。', 'error'); return; }
  if (!manualSession.value.trim()) { notify('请粘贴 esim.gg session token。', 'error'); return; }
  importingSession.value = true;
  try {
    const result = await api('esimgg/session', {
      method: 'POST',
      body: JSON.stringify({ session: manualSession.value, label: accountLabel.value, accountId: editingAccountId.value || null }),
    });
    manualSession.value = '';
    showManualSession.value = false;
    applyProviderStatus(result);
    form.providerSessionId = result.accountId;
    closeSessionImporter();
    notify('esim.gg 账号验证成功并已加密保存。');
  } catch (error) { notify(error.message, 'error'); }
  finally { importingSession.value = false; }
}

async function save() {
  if (!form.providerSessionId) { notify('请选择监控要使用的 esim.gg 账号。', 'error'); return; }
  saving.value = true;
  try {
    const body = JSON.stringify(payload());
    const result = await api(form.id ? `monitors/${form.id}` : 'monitors', { method: form.id ? 'PUT' : 'POST', body });
    const wasInline = Boolean(inlineMonitorId.value);
    if (form.id) notify('监控已更新。');
    else if (result.emailSent === false) notify(`监控已创建，但测试邮件发送失败：${result.emailError || '未知错误'}`, 'error');
    else notify('监控已创建，测试邮件已发送。');
    if (wasInline) inlineMonitorId.value = '';
    resetForm(); await refresh();
  } catch (error) { notify(error.message, 'error'); }
  finally { saving.value = false; }
}

async function checkMonitor(monitor) {
  checkingId.value = monitor.id;
  try {
    const result = await api(`monitors/${monitor.id}/check`, { method: 'POST' });
    if (!saveLocalCheckRun(appState.user?.id, result.run)) notify('检查完成，但浏览器无法保存本地历史。', 'error');
    notify(`检查完成：找到 ${result.candidates?.length || 0} 个符合条件的号码。`);
    await refresh();
  }
  catch (error) {
    if (error.data?.run) saveLocalCheckRun(appState.user?.id, error.data.run);
    notify(error.message, 'error');
  }
  finally { checkingId.value = ''; }
}

async function requestRemoveMonitor(monitor) {
  deleteTarget.value = monitor;
  await nextTick();
  deleteDialog.value?.showModal();
}

function closeDeleteDialog() {
  if (!deletingId.value) deleteDialog.value?.close();
}

function handleDeleteCancel(event) {
  if (deletingId.value) event.preventDefault();
}

async function confirmRemoveMonitor() {
  const monitor = deleteTarget.value;
  if (!monitor) return;
  deletingId.value = monitor.id;
  try {
    await api(`monitors/${monitor.id}`, { method: 'DELETE' });
    deleteLocalCheckHistoryForMonitor(appState.user?.id, monitor.id);
    if (inlineMonitorId.value === monitor.id) closeInlineEditor();
    deleteDialog.value?.close();
    notify('监控已删除。');
    await refresh();
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    deletingId.value = '';
  }
}

function manualOrderMonitor(item = manualOrderTarget.value) {
  return monitors.value.find((monitor) => monitor.id === item?.monitor_id) || null;
}

function requestManualOrder(item) {
  if (!manualOrderMonitor(item)?.action?.enabled) {
    notify('请先编辑此监控任务，启用“自动创建待支付订单”配置。', 'error');
    return;
  }
  manualOrderTarget.value = item;
}

async function confirmManualOrder(coupon = 'setup') {
  const item = manualOrderTarget.value;
  const monitor = manualOrderMonitor(item);
  if (!item || !monitor) return;
  creatingManualOrder.value = true;
  try {
    const data = await api(`monitors/${encodeURIComponent(monitor.id)}/numbers/order`, {
      method: 'POST',
      body: JSON.stringify({ number: item.number, expectedPrice: item.price, coupon, acknowledged: true }),
    });
    item.payment_url = data.order.paymentUrl;
    item.order_status = 'created';
    manualOrderTarget.value = null;
    notify(data.reused ? '已找到这个号码现有的支付链接。' : '支付链接已生成。');
    if (data.emailSent === false) notify(`链接已生成，但邮件发送失败：${data.emailError || '未知错误'}`, 'error');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    creatingManualOrder.value = false;
  }
}

onMounted(async () => {
  await refresh();
  if (isSettingsPage.value && typeof route.query.monitor === 'string') {
    const monitor = monitors.value.find((item) => item.id === route.query.monitor);
    if (monitor) editMonitor(monitor);
  }
});
watch(() => route.name, (name) => { if (name !== 'dashboard') inlineMonitorId.value = ''; });
onBeforeUnmount(() => window.clearInterval(importPollTimer));
</script>

<template>
  <div class="page-shell dashboard-page">
    <PageHero :eyebrow="isSettingsPage ? 'ESIM.GG CONFIGURATION' : 'AVAILABILITY OPERATIONS'" :title="isSettingsPage ? '监控配置' : '监控中心'" :description="isSettingsPage ? '安全导入你的 esim.gg 会话，并设置查询频率、通知邮箱和待支付订单规则。' : '每分钟自动轮询可用号码，按价格规则创建待支付订单并通过 Resend 通知。最终付款始终由你确认。'">
      <div class="live-chip"><span class="online"></span><div><strong>LinuxDo 已登录</strong><small>Cron 每分钟执行</small></div></div>
    </PageHero>

    <section v-if="!isSettingsPage" class="metrics" aria-label="监控概览">
      <MetricCard label="监控任务" :value="monitors.length" caption="已配置来源" />
      <MetricCard label="运行中" :value="monitors.filter((item) => item.enabled).length" caption="按 Cron 自动检查" />
      <MetricCard label="已发现" :value="discoveries.length" caption="符合筛选的记录" accent />
    </section>

    <div class="dashboard-grid dashboard-grid-single">
      <section v-if="!isSettingsPage" class="panel monitor-panel" aria-labelledby="monitor-title">
        <div class="panel-heading"><div><p class="eyebrow">SOURCES</p><h2 id="monitor-title">监控任务</h2></div><button class="button button-secondary" type="button" @click="openNewMonitor">新建任务</button></div>
        <div class="monitor-list">
          <div v-if="loading && !monitors.length" class="skeleton-stack"><div v-for="item in 2" :key="item" class="skeleton-card"></div></div>
          <div v-else-if="!monitors.length" class="empty-state">还没有属于你的监控任务。</div>
          <article v-for="monitor in monitors" :key="monitor.id" class="monitor-card">
            <div class="monitor-card-head"><div class="min-width-0"><h3>{{ monitor.name }}</h3><p class="monitor-url">{{ monitor.url }}</p></div><StatusBadge :tone="monitor.enabled ? 'success' : 'neutral'">{{ monitor.enabled ? '运行中' : '已暂停' }}</StatusBadge></div>
            <div class="monitor-card-footer"><div class="monitor-meta"><span>{{ monitor.providerSessionLabel || '未选择账号' }}</span><span>每 {{ monitor.intervalMinutes }} 分钟</span><span>{{ monitor.filters?.checkRounds || 1 }} 轮/次</span><span>上次 {{ formatDate(monitor.lastCheckedAt) }}</span></div><div class="monitor-actions"><button class="button button-small button-secondary" type="button" :disabled="checkingId === monitor.id" @click="checkMonitor(monitor)">{{ checkingId === monitor.id ? '检查中…' : '立即检查' }}</button><button class="button button-small button-ghost" type="button" @click="openMonitorEditor(monitor)">编辑</button><button class="button button-small button-danger" type="button" @click="requestRemoveMonitor(monitor)">删除</button></div></div>
            <p v-if="monitor.lastError" class="inline-error">{{ monitor.lastError }}</p>
          </article>
        </div>
      </section>

      <section v-if="isSettingsPage || inlineMonitorId" ref="editor" class="editor-panel settings-editor-panel" aria-label="esim.gg 配置">
        <section v-if="!inlineMonitorId" class="account-manager" aria-labelledby="account-manager-title">
          <div class="account-manager-heading"><div><p class="eyebrow">ESIM.GG ACCOUNTS</p><h2 id="account-manager-title">已绑定账号</h2><p>每个账号的会话独立加密保存，监控任务只会使用你指定的账号。</p></div><button class="button button-secondary" type="button" @click="addProviderAccount">绑定新账号</button></div>
          <div v-if="!providerStatusLoaded" class="account-empty">正在读取账号…</div>
          <div v-else-if="!providerAccounts.length" class="account-empty"><strong>还没有绑定 esim.gg 账号</strong><span>先绑定一个账号，之后才能创建监控任务。</span></div>
          <div v-else class="provider-account-list">
            <article v-for="account in providerAccounts" :key="account.id" class="provider-account-item" :class="{ expired: !account.configured }">
              <span class="session-state-dot" aria-hidden="true"></span>
              <div class="provider-account-copy"><strong>{{ account.label }}</strong><p>{{ account.configured ? '会话可用' : '会话已过期' }} · {{ account.monitorCount }} 个任务使用<span v-if="account.expiresAt"> · {{ formatDate(account.expiresAt) }} 到期</span></p></div>
              <div class="provider-account-actions"><button class="button button-small button-ghost" type="button" @click="updateProviderAccount(account)">更新会话</button><button class="button button-small button-danger" type="button" :disabled="account.monitorCount > 0" :title="account.monitorCount > 0 ? '请先修改或删除使用此账号的监控任务' : '解绑账号'" @click="removeProviderAccount(account)">解绑</button></div>
            </article>
          </div>
        </section>

        <section v-if="showSessionImporter && !inlineMonitorId" class="web-import-card" aria-labelledby="web-import-title">
          <div class="web-import-heading"><div><p class="eyebrow">{{ editingAccountId ? 'UPDATE ACCOUNT' : 'NEW ACCOUNT' }}</p><h3 id="web-import-title">{{ editingAccountId ? '更新 esim.gg 账号' : '绑定 esim.gg 账号' }}</h3></div><button class="button button-small button-ghost" type="button" @click="closeSessionImporter">取消</button></div>
          <ol class="web-import-steps">
            <li><span>1</span><div><strong>登录 esim.gg</strong><p>在浏览器中完成正常登录，然后停留在 esim.gg 页面。</p><a class="button button-small button-secondary" href="https://esim.gg/login?callbackUrl=/new/number/estonia" target="_blank" rel="noreferrer">打开 esim.gg 登录</a></div></li>
            <li><span>2</span><div><strong>复制 Session Token</strong><p>按 <code>F12</code> → <code>Application / 应用</code> → <code>Cookies</code> → <code>https://esim.gg</code>，选择 <code>__Secure-nekopass.session_token</code> 并复制 Value。</p></div></li>
          </ol>
          <form class="session-import-form" @submit.prevent="importSessionFromWeb">
            <label for="esimgg-account-label">账号备注<input id="esimgg-account-label" v-model.trim="accountLabel" required maxlength="60" placeholder="例如：主账号、工作账号" /><small>用于区分账号，不需要填写 esim.gg 密码。</small></label>
            <label for="esimgg-session-value">Session token
              <span class="secret-input-row"><input id="esimgg-session-value" v-model="manualSession" :type="showManualSession ? 'text' : 'password'" required autocomplete="off" spellcheck="false" placeholder="粘贴 token 或完整 Cookie 内容" /><button class="button button-ghost" type="button" :aria-pressed="showManualSession" @click="showManualSession = !showManualSession">{{ showManualSession ? '隐藏' : '显示' }}</button></span>
              <small>支持只粘贴 Value，也支持包含 <code>__Secure-nekopass.session_token=...</code> 的完整 Cookie 行。</small>
            </label>
            <button class="button button-primary" type="submit" :disabled="importingSession">{{ importingSession ? '正在验证…' : editingAccountId ? '验证并更新账号' : '验证并绑定账号' }}</button>
          </form>
          <p class="security-note">提交后 Worker 会先验证会话，再使用 AES-GCM 加密保存；页面不会回显已保存的 token。由于浏览器的跨域与 HttpOnly 限制，本页面不能自动读取 esim.gg Cookie。</p>
        </section>

        <details v-if="showSessionImporter && !inlineMonitorId" class="setup-guide cli-import-guide">
          <summary>高级方式：使用命令行自动读取</summary>
          <ol class="setup-steps">
            <li><span>01</span><div><strong>打开专用登录浏览器</strong><p>在项目目录的终端运行：</p><code>npm run esimgg:login</code></div></li>
            <li><span>02</span><div><strong>完成正常登录</strong><p>在自动打开的独立 Chrome / Edge 窗口登录 esim.gg，登录完成后保留窗口。</p></div></li>
            <li><span>03</span><div><strong>生成一次性导入命令</strong><p>导入码仅属于当前 LinuxDo 用户，使用一次或 10 分钟后失效。</p><button class="button button-secondary" type="button" :disabled="generatingCode" @click="generateImportCode">{{ generatingCode ? '生成中…' : importCode ? '重新生成导入码' : '生成导入码' }}</button><template v-if="importCode"><code class="import-command">{{ importCommand }}</code><small>有效期至 {{ formatDate(importExpiresAt) }}。复制整条命令回终端执行。</small></template></div></li>
          </ol>
          <p class="security-note">这个方式适合本地运行开源项目的用户，脚本会自动读取 Cookie，无需手动复制 Value。</p>
        </details>

        <form class="editor-form esimgg-form settings-form-card" @submit.prevent="save">
          <div class="settings-section-heading"><div><p class="eyebrow">MONITOR RULES</p><h2>{{ form.id ? '编辑监控参数' : '创建监控任务' }}</h2><p>设置通知目标、查询频率和符合价格上限后的处理方式。</p></div><div class="settings-heading-actions"><StatusBadge tone="success">ESIM.GG ONLY</StatusBadge><button v-if="inlineMonitorId" class="button button-small button-ghost" type="button" @click="closeInlineEditor">收起编辑</button></div></div>
          <div class="monitor-account-field field-control"><span class="field-label">使用账号</span><UiSelect v-model="form.providerSessionId" :options="accountOptions" label="选择监控使用的 esim.gg 账号" /><small>查询和创建待支付订单都只会使用这个账号；保存后仍可修改。</small></div>
          <div class="form-grid two"><label>任务名称<input v-model.trim="form.name" required maxlength="120" /></label><label>Resend 通知邮箱<input v-model.trim="form.notifyEmail" required type="email" placeholder="you@example.com" /></label></div>
          <div class="form-grid two"><label>每分钟查询轮数<input v-model.number="form.checkRounds" type="number" min="1" max="5" /><small>推荐 3 轮，每轮通常返回约 12 个号码。</small></label><label>轮次间隔（秒）<input v-model.number="form.roundDelaySeconds" type="number" min="0" max="10" step="1" /><small>推荐 1 秒，避免瞬间连续请求。</small></label></div>

          <div class="automation-card">
            <label class="check-label choice-card"><input v-model="form.enabled" class="choice-native" type="checkbox" /><span class="choice-box" aria-hidden="true"></span><span>保存后启用每分钟自动监控</span></label>
            <label class="check-label choice-card"><input v-model="form.actionEnabled" class="choice-native" type="checkbox" /><span class="choice-box" aria-hidden="true"></span><span>找到符合价格上限的号码后自动创建待支付订单，并邮件发送 Stripe 链接</span></label>
            <div v-if="form.actionEnabled" class="automation-price-grid">
              <label class="automation-price-field" for="monitor-max-candidate-price">自动生成支付链接的最高号码费（EUR）<input id="monitor-max-candidate-price" v-model.number="form.maxCandidatePrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" /><small>{{ Number(form.maxCandidatePrice || 0) > 0 ? `价格不高于 €${Number(form.maxCandidatePrice).toFixed(2)} 的号码会尝试生成链接。` : '填 0 表示仅处理免费号码（€0.00）。' }}</small></label>
              <label class="automation-price-field" for="monitor-recharge-amount">初始预存金额（EUR）<input id="monitor-recharge-amount" v-model.number="form.rechargeAmount" type="number" min="0.02" step="0.01" inputmode="decimal" required aria-describedby="monitor-recharge-help" placeholder="1.00" /><small id="monitor-recharge-help">esim.gg 最低允许预存 €0.02；最终优惠与待支付总额以 Stripe 页面为准。</small></label>
              <label class="automation-price-field automation-coupon-field" for="monitor-coupon">优惠码<input id="monitor-coupon" v-model.trim="form.coupon" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="monitor-coupon-help" /><small id="monitor-coupon-help">默认 <code>setup</code>，预计减 €0.40；可修改或清空，最终优惠以 Stripe 页面为准。</small></label>
            </div>
            <label v-if="form.actionEnabled" class="check-label choice-card"><input v-model="form.actionAcknowledged" class="choice-native" required type="checkbox" /><span class="choice-box" aria-hidden="true"></span><span>我确认这一步只创建待支付订单，最终付款仍由我手动完成</span></label>
            <p>{{ form.actionEnabled && Number(form.maxCandidatePrice || 0) > 0 ? `固定规则：仅匹配 +372、EUR，价格不高于 €${Number(form.maxCandidatePrice).toFixed(2)}；每次最多创建 1 个订单，创建成功后暂停任务。` : '固定规则：仅匹配 +372、显示号码费 €0.00；每次最多创建 1 个订单，创建成功后暂停任务。' }}</p>
          </div>

          <div class="form-actions"><button class="button button-primary" type="submit" :disabled="saving || !form.providerSessionId">{{ saving ? '保存中…' : form.id ? '保存修改' : '创建监控' }}</button><button class="button button-ghost" type="button" @click="applyPreset">恢复推荐参数</button><button v-if="inlineMonitorId" class="button button-ghost" type="button" @click="closeInlineEditor">取消编辑</button></div>
        </form>
      </section>
    </div>

    <section v-if="!isSettingsPage" class="panel discoveries-panel" aria-labelledby="discoveries-title">
      <div class="panel-heading"><div><p class="eyebrow">DISCOVERIES</p><h2 id="discoveries-title">最近发现</h2></div><div class="panel-actions"><RouterLink class="button button-secondary" to="/history">本机检查历史</RouterLink><button class="button button-ghost" type="button" :disabled="loading" @click="refresh">刷新</button></div></div>
      <div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>号码</th><th>价格</th><th>来源</th><th>订单</th><th>首次发现</th><th>支付</th></tr></thead><tbody><tr v-if="!discoveries.length" class="mobile-table-empty"><td colspan="6" class="empty-state">还没有发现符合条件的号码。</td></tr><tr v-for="item in discoveries" :key="item.id"><td data-label="号码"><strong class="mono">{{ item.number }}</strong></td><td data-label="价格">{{ formatMoney(item.price, item.currency) }}</td><td data-label="来源">{{ item.monitor_name }}</td><td data-label="订单"><StatusBadge v-if="item.order_status" :tone="item.order_status === 'created' ? 'success' : item.order_status === 'failed' ? 'danger' : 'neutral'">{{ item.order_status }}</StatusBadge><span v-else>仅通知</span></td><td data-label="首次发现">{{ formatDate(item.first_seen_at) }}</td><td data-label="支付"><a v-if="item.payment_url" class="button button-small button-primary" :href="item.payment_url" target="_blank" rel="noreferrer">去支付</a><button v-else class="button button-small button-secondary" type="button" @click="requestManualOrder(item)">生成支付链接</button></td></tr></tbody></table></div>
    </section>

    <ManualOrderDialog :open="Boolean(manualOrderTarget)" :item="manualOrderTarget" :monitor-name="manualOrderMonitor()?.name" :account-label="manualOrderMonitor()?.providerSessionLabel" :notify-email="manualOrderMonitor()?.notifyEmail" :coupon="couponFromAction(manualOrderMonitor()?.action)" :loading="creatingManualOrder" @cancel="manualOrderTarget = null" @confirm="confirmManualOrder" />

    <Teleport to="body">
    <dialog ref="deleteDialog" class="confirm-dialog" aria-labelledby="delete-monitor-title" aria-describedby="delete-monitor-description" @click.self="closeDeleteDialog" @cancel="handleDeleteCancel" @close="deleteTarget = null">
      <div class="confirm-dialog-card">
        <div class="confirm-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></div>
        <div class="confirm-dialog-copy">
          <p class="eyebrow">DELETE MONITOR</p>
          <h2 id="delete-monitor-title">删除这个监控任务？</h2>
          <p id="delete-monitor-description">任务 <strong>“{{ deleteTarget?.name }}”</strong>、本机查询历史、发现记录和订单摘要都会永久删除。全站共享号码目录不会受影响。此操作无法撤销。</p>
        </div>
        <div class="confirm-dialog-actions">
          <button class="button button-secondary" type="button" :disabled="Boolean(deletingId)" autofocus @click="closeDeleteDialog">取消</button>
          <button class="button button-danger" type="button" :disabled="Boolean(deletingId)" @click="confirmRemoveMonitor"><span v-if="deletingId" class="spinner" aria-hidden="true"></span>{{ deletingId ? '正在删除…' : '确认删除' }}</button>
        </div>
      </div>
    </dialog>
    </Teleport>
  </div>
</template>
