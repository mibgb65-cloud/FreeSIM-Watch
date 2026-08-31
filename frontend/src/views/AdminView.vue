<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import PageHero from '../components/PageHero.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { api, appState, formatDate, notify } from '../lib/session';

const loading = ref(false);
const savingQuota = ref(null);
const savingKey = ref(false);
const savingRegistrationLimit = ref(false);
const managingUserId = ref('');
const users = ref([]);
const userStats = ref({ total: 0, admins: 0, banned: 0, levels: [0, 0, 0, 0, 0], registrationLimit: 10 });
const registrationLimit = ref(10);
const quotas = ref([]);
const resendKeys = ref([]);
const legacyConfigured = ref(false);
const keyEditorId = ref('');
const keyForm = reactive({ domain: '', apiKey: '', active: true });
const activeSection = ref('users');
const adminTabs = ref(null);
const sectionTabs = [
  { id: 'users', label: '用户概览', caption: 'USERS' },
  { id: 'quotas', label: '监控配额', caption: 'QUOTAS' },
  { id: 'resend', label: '邮件密钥', caption: 'RESEND' },
];
const userLevelStats = computed(() => userStats.value.levels.map((count, trustLevel) => ({ trustLevel, count })));
const remainingRegistrations = computed(() => Math.max(0, userStats.value.registrationLimit - userStats.value.total));

const normalizedDomain = computed(() => keyForm.domain.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase());
const generatedFromAddress = computed(() => normalizedDomain.value ? `FreeSIM Watch <alerts@${normalizedDomain.value}>` : 'FreeSIM Watch <alerts@example.com>');

function domainFromAddress(value) {
  const email = value?.match(/<([^<>]+)>$/)?.[1] || value || '';
  return email.split('@').pop()?.trim().toLowerCase() || '';
}

function isValidDomain(value) {
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value);
}

function resetKeyForm() {
  keyEditorId.value = '';
  keyForm.domain = '';
  keyForm.apiKey = '';
  keyForm.active = true;
}

function editKey(key) {
  keyEditorId.value = key.id;
  keyForm.domain = domainFromAddress(key.fromAddress) || key.label;
  keyForm.apiKey = '';
  keyForm.active = key.active;
  activeSection.value = 'resend';
  nextTick(() => document.querySelector('.resend-key-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function handleTabKeydown(event, index) {
  const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? sectionTabs.length - 1 : (index + direction + sectionTabs.length) % sectionTabs.length;
  if (!direction && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  activeSection.value = sectionTabs[nextIndex].id;
  nextTick(() => adminTabs.value?.querySelectorAll('[role="tab"]')[nextIndex]?.focus());
}

async function refresh() {
  loading.value = true;
  try {
    const [userData, quotaData, keyData] = await Promise.all([
      api('admin/users'), api('admin/quota-rules'), api('admin/resend/keys'),
    ]);
    users.value = userData.users;
    userStats.value = userData.stats || {
      total: userData.users.length,
      admins: userData.users.filter((user) => user.role === 'admin').length,
      banned: userData.users.filter((user) => user.bannedAt).length,
      levels: Array.from({ length: 5 }, (_, trustLevel) => userData.users.filter((user) => user.trustLevel === trustLevel).length),
      registrationLimit: 10,
    };
    registrationLimit.value = userStats.value.registrationLimit;
    quotas.value = quotaData.rules;
    resendKeys.value = keyData.keys;
    legacyConfigured.value = keyData.legacyConfigured;
    appState.connected = true;
  } catch (error) { notify(error.message, 'error'); }
  finally { loading.value = false; }
}

async function saveRegistrationLimit() {
  savingRegistrationLimit.value = true;
  try {
    const data = await api('admin/registration-limit', { method: 'PUT', body: JSON.stringify({ maximumUsers: registrationLimit.value }) });
    userStats.value.registrationLimit = data.registrationLimit;
    registrationLimit.value = data.registrationLimit;
    notify(`总注册用户上限已调整为 ${data.registrationLimit} 人。`);
  } catch (error) { notify(error.message, 'error'); }
  finally { savingRegistrationLimit.value = false; }
}

async function toggleUserBan(target) {
  const action = target.bannedAt ? '解除封禁' : '封禁';
  const detail = target.bannedAt ? '解除后用户可以重新登录，但其监控任务不会自动恢复。' : '封禁会立即退出该用户并停用其全部监控任务。';
  if (!confirm(`确定${action}“${target.name}”（@${target.username}）吗？\n\n${detail}`)) return;
  managingUserId.value = target.id;
  try {
    await api(`admin/users/${encodeURIComponent(target.id)}?action=${target.bannedAt ? 'unban' : 'ban'}`, { method: target.bannedAt ? 'DELETE' : 'PUT' });
    notify(`用户已${action}。`);
    await refresh();
  } catch (error) { notify(error.message, 'error'); }
  finally { managingUserId.value = ''; }
}

async function removeUser(target) {
  if (!confirm(`永久删除“${target.name}”（@${target.username}）吗？\n\n用户、会话、esim.gg 加密凭据、监控、发现和订单都会删除，且不可恢复。`)) return;
  managingUserId.value = target.id;
  try {
    await api(`admin/users/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
    notify('用户及其关联数据已永久删除。');
    await refresh();
  } catch (error) { notify(error.message, 'error'); }
  finally { managingUserId.value = ''; }
}

async function saveQuota(rule) {
  savingQuota.value = rule.trustLevel;
  try {
    const data = await api(`admin/quota-rules/${rule.trustLevel}`, { method: 'PUT', body: JSON.stringify({ maxMonitors: rule.maxMonitors }) });
    quotas.value = data.rules;
    notify(`信任等级 ${rule.trustLevel} 的监控上限已保存。`);
    await refresh();
  } catch (error) { notify(error.message, 'error'); }
  finally { savingQuota.value = null; }
}

async function resetQuota(rule) {
  try {
    const data = await api(`admin/quota-rules/${rule.trustLevel}`, { method: 'DELETE' });
    quotas.value = data.rules;
    notify(`信任等级 ${rule.trustLevel} 已恢复默认上限。`);
  } catch (error) { notify(error.message, 'error'); }
}

async function saveKey() {
  const domain = normalizedDomain.value;
  if (!isValidDomain(domain)) { notify('请输入有效域名，例如 example.com。', 'error'); return; }
  if (!keyEditorId.value && !keyForm.apiKey.trim()) { notify('请填写 Resend API Key。', 'error'); return; }
  savingKey.value = true;
  try {
    const body = { domain, active: keyForm.active, ...(keyForm.apiKey.trim() ? { apiKey: keyForm.apiKey.trim() } : {}) };
    const data = await api(keyEditorId.value ? `admin/resend/keys/${keyEditorId.value}` : 'admin/resend/keys', { method: keyEditorId.value ? 'PUT' : 'POST', body: JSON.stringify(body) });
    if (keyEditorId.value) resendKeys.value = resendKeys.value.map((key) => key.id === data.key.id ? data.key : key);
    else resendKeys.value.push(data.key);
    notify(keyEditorId.value ? 'Resend Key 已更新。' : 'Resend Key 已添加。');
    resetKeyForm();
  } catch (error) { notify(error.message, 'error'); }
  finally { savingKey.value = false; }
}

async function removeKey(key) {
  if (!confirm(`确定删除“${key.label}”（${key.keyHint}）吗？`)) return;
  try {
    await api(`admin/resend/keys/${key.id}`, { method: 'DELETE' });
    resendKeys.value = resendKeys.value.filter((item) => item.id !== key.id);
    if (keyEditorId.value === key.id) resetKeyForm();
    notify('Resend Key 已删除。');
  } catch (error) { notify(error.message, 'error'); }
}

onMounted(refresh);
</script>

<template>
  <div class="page-shell admin-page">
    <PageHero eyebrow="ADMINISTRATION" title="系统管理" description="只有管理员可以看到这些设置。配额在 Worker 后端强制执行，Resend Key 只保存加密密文。">
      <div class="live-chip"><span class="online"></span><div><strong>管理员模式</strong><small>{{ appState.user?.name }} · 信任等级 {{ appState.user?.trustLevel ?? '—' }}</small></div></div>
    </PageHero>

    <nav ref="adminTabs" class="admin-tabs" role="tablist" aria-label="管理设置分区">
      <button v-for="(tab, index) in sectionTabs" :key="tab.id" :id="`admin-tab-${tab.id}`" class="admin-tab" :class="{ active: activeSection === tab.id }" type="button" role="tab" :aria-selected="activeSection === tab.id" :aria-controls="`admin-panel-${tab.id}`" :tabindex="activeSection === tab.id ? 0 : -1" @click="activeSection = tab.id" @keydown="handleTabKeydown($event, index)"><span>{{ tab.label }}</span><small>{{ tab.caption }}</small></button>
    </nav>

    <Transition name="admin-section-slide" mode="out-in">
      <section v-if="activeSection === 'users'" id="admin-panel-users" key="users" class="admin-section" role="tabpanel" aria-labelledby="admin-tab-users">
        <div class="admin-section-heading"><div><p class="eyebrow">USERS</p><h2 id="users-title">用户概览</h2><p>信任等级取自 LinuxDo 最近一次登录资料；顶部统计覆盖全库用户，明细表展示最近 500 位。</p></div><button class="button button-small button-ghost" type="button" :disabled="loading" @click="refresh">刷新</button></div>
        <div class="admin-user-stats" aria-label="用户统计"><article class="admin-user-stat admin-user-stat-total"><span>注册用户</span><strong>{{ userStats.total }} / {{ userStats.registrationLimit }}</strong><small>剩余 {{ remainingRegistrations }} 个名额</small></article><article class="admin-user-stat admin-user-stat-admin"><span>管理员</span><strong>{{ userStats.admins }}</strong><small>拥有管理权限</small></article><article class="admin-user-stat admin-user-stat-banned"><span>已封禁</span><strong>{{ userStats.banned }}</strong><small>保留数据但禁止登录</small></article></div>
        <form class="admin-registration-limit" @submit.prevent="saveRegistrationLimit"><div><strong>总注册用户上限</strong><span>降低到当前人数以下不会踢出已有用户，只会暂停新用户注册。</span></div><label>最多用户<input v-model.number="registrationLimit" type="number" min="1" max="100000" required /></label><button class="button button-primary" type="submit" :disabled="savingRegistrationLimit">{{ savingRegistrationLimit ? '保存中…' : '保存上限' }}</button></form>
        <div class="admin-level-stats" role="list" aria-label="各信任等级用户数"><article v-for="item in userLevelStats" :key="item.trustLevel" class="admin-level-stat" role="listitem"><span>等级 {{ item.trustLevel }}</span><strong>{{ item.count }}</strong><small>位用户</small></article></div>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>用户</th><th>等级</th><th>任务</th><th>上限</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody><tr v-if="!users.length" class="admin-empty-row"><td colspan="7" class="empty-state">暂无用户资料。</td></tr><tr v-for="user in users" :key="user.id" :class="{ 'admin-user-banned': user.bannedAt }"><td data-label="用户"><strong>{{ user.name }}</strong><small>@{{ user.username }}</small></td><td data-label="等级"><span class="level-pill">{{ user.trustLevel }}</span><StatusBadge v-if="user.role === 'admin'" tone="success">管理员</StatusBadge></td><td data-label="任务">{{ user.monitorCount }}</td><td data-label="上限">{{ user.maxMonitors }}</td><td data-label="状态"><StatusBadge :tone="user.bannedAt ? 'danger' : 'success'">{{ user.bannedAt ? '已封禁' : '正常' }}</StatusBadge></td><td data-label="最近登录">{{ formatDate(user.lastLoginAt) }}</td><td data-label="操作"><div class="admin-user-actions"><button class="button button-small button-ghost" type="button" :disabled="user.id === appState.user?.id || managingUserId === user.id" @click="toggleUserBan(user)">{{ user.bannedAt ? '解封' : '封禁' }}</button><button class="button button-small button-danger" type="button" :disabled="user.id === appState.user?.id || managingUserId === user.id" @click="removeUser(user)">删除</button></div></td></tr></tbody></table></div>
      </section>

      <section v-else-if="activeSection === 'quotas'" id="admin-panel-quotas" key="quotas" class="admin-section" role="tabpanel" aria-labelledby="admin-tab-quotas">
        <div class="admin-section-heading"><div><p class="eyebrow">MONITOR QUOTAS</p><h2 id="quota-title">按信任等级设置上限</h2><p>上限表示每位用户最多可以创建的监控任务数量，0 表示禁止新建。</p></div><StatusBadge tone="neutral">0 — 4 级</StatusBadge></div>
        <div class="quota-list"><article v-for="rule in quotas" :key="rule.trustLevel" class="quota-row"><div class="quota-level"><strong>信任等级 {{ rule.trustLevel }}</strong><small>{{ rule.isCustom ? '自定义规则' : '跟随环境默认值' }}</small></div><label class="quota-input">最多监控<input v-model.number="rule.maxMonitors" type="number" min="0" max="20" aria-label="监控任务上限" /></label><div class="quota-actions"><button class="button button-small button-primary" type="button" :disabled="savingQuota === rule.trustLevel" @click="saveQuota(rule)">{{ savingQuota === rule.trustLevel ? '保存中…' : '保存' }}</button><button v-if="rule.isCustom" class="button button-small button-ghost" type="button" @click="resetQuota(rule)">恢复默认</button></div></article></div>
      </section>

      <section v-else id="admin-panel-resend" key="resend" class="admin-section admin-resend-section" role="tabpanel" aria-labelledby="admin-tab-resend">
        <div class="admin-section-heading"><div><p class="eyebrow">RESEND ROTATION</p><h2 id="resend-title">Resend API Keys</h2><p>发送时按最近使用时间轮换；遇到 Key 无效、无权限、额度或限流（401、402、403、429）会自动跳到下一把，并暂时冷却失败 Key。</p></div><StatusBadge :tone="resendKeys.length ? 'success' : 'warning'">{{ resendKeys.length ? `${resendKeys.length} 把托管 Key` : '尚未托管 Key' }}</StatusBadge></div>
        <p v-if="legacyConfigured" class="admin-note">当前仍配置了环境变量中的默认 Key。添加第一把托管 Key 后，邮件发送将优先使用托管列表；默认 Key 仅作为没有可用托管 Key 时的兼容回退。</p>
        <div v-if="!resendKeys.length" class="account-empty"><strong>还没有托管 Resend Key</strong><span>添加至少两把不同发件域名的 Key，才能实现轮换。</span></div>
        <div v-else class="resend-key-list"><article v-for="key in resendKeys" :key="key.id" class="resend-key-item"><div class="resend-key-main"><strong>{{ key.label }}</strong><span>{{ key.keyHint }}</span><StatusBadge :tone="key.active ? 'success' : 'neutral'">{{ key.active ? '启用' : '停用' }}</StatusBadge><p>{{ key.fromAddress }} · {{ key.lastError || (key.lastUsedAt ? `最近使用：${formatDate(key.lastUsedAt)}` : '尚未使用') }}<span v-if="key.consecutiveFailures"> · 连续失败 {{ key.consecutiveFailures }} 次</span><span v-if="key.cooldownUntil"> · 冷却至 {{ formatDate(key.cooldownUntil) }}</span></p></div><div class="provider-account-actions"><button class="button button-small button-ghost" type="button" @click="editKey(key)">编辑</button><button class="button button-small button-danger" type="button" @click="removeKey(key)">删除</button></div></article></div>
        <form class="resend-key-form" @submit.prevent="saveKey"><div class="admin-form-heading"><strong>{{ keyEditorId ? '更新托管 Key' : '添加托管 Key' }}</strong><button v-if="keyEditorId" class="button button-small button-ghost" type="button" @click="resetKeyForm">取消编辑</button></div><div class="form-grid two"><label>发件域名（也是 Key 名称）<input v-model.trim="keyForm.domain" required maxlength="253" type="text" inputmode="url" autocomplete="url" spellcheck="false" placeholder="例如：example.com" /></label><label>自动发件人<input :value="generatedFromAddress" type="text" readonly aria-readonly="true" /><small>由上方域名自动生成；请确保该域名已在 Resend 验证。</small></label></div><label>API Key <span v-if="keyEditorId" class="optional-label">留空表示不更换</span><input v-model="keyForm.apiKey" :required="!keyEditorId" type="password" autocomplete="new-password" placeholder="re_…" /></label><label class="check-label choice-card"><input v-model="keyForm.active" class="choice-native" type="checkbox" /><span class="choice-box" aria-hidden="true"></span><span>启用这把 Key 参与轮换</span></label><div class="form-actions"><button class="button button-primary" type="submit" :disabled="savingKey">{{ savingKey ? '保存中…' : keyEditorId ? '保存 Key 修改' : '添加 Key' }}</button></div><p class="security-note">API Key 只在提交时传输，Worker 使用 AES-GCM 加密保存；列表只显示末四位，不会回显完整密钥。</p></form>
      </section>
    </Transition>
  </div>
</template>
