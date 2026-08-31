<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import ManualOrderDialog from '../components/ManualOrderDialog.vue';
import MetricCard from '../components/MetricCard.vue';
import PageHero from '../components/PageHero.vue';
import StatusBadge from '../components/StatusBadge.vue';
import UiSelect from '../components/UiSelect.vue';
import { couponFromAction } from '../lib/order';
import { api, appState, formatDate, formatMoney, notify } from '../lib/session';

const form = reactive({ monitorId: '', query: '', minPrice: null, maxPrice: null, currency: 'EUR' });
const route = useRoute();
const results = ref([]);
const recommended = ref([]);
const searchedAt = ref(null);
const total = ref(0);
const loading = ref(false);
const creatingManualOrder = ref(false);
const manualOrderTarget = ref(null);
const orderUrls = reactive({});
const monitors = computed(() => appState.monitors);
const monitorOptions = computed(() => [
  { value: '', label: monitors.value.length ? '选择生成链接使用的 esim.gg 账号' : '还没有可用的 esim.gg 账号', disabled: true },
  ...monitors.value.map((monitor) => ({
    value: monitor.id,
    label: `${monitor.providerSessionLabel || '未命名 esim.gg 账号'} · ${monitor.name}`,
  })),
]);
const priced = computed(() => results.value.filter((item) => item.price != null));
const lowest = computed(() => priced.value.length ? formatMoney(Math.min(...priced.value.map((item) => Number(item.price))), priced.value[0].currency) : '—');
const freeCount = computed(() => results.value.filter((item) => Number(item.price) === 0).length);

function relativeTime(value) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return '刚刚出现';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function recommendationReason(item) {
  if (Number(item.price) === 0) return '免费优先';
  return '近期低价';
}

function setMonitorDefaults() {
  if (!form.monitorId && typeof route.query.monitorId === 'string' && monitors.value.some((item) => item.id === route.query.monitorId)) {
    form.monitorId = route.query.monitorId;
  }
  if (!form.monitorId && monitors.value.length) form.monitorId = monitors.value[0].id;
  if (!form.query && typeof route.query.number === 'string') form.query = route.query.number.slice(0, 40);
}

async function loadMonitors() {
  if (!appState.user) return;
  try {
    const [data, orderData] = await Promise.all([api('monitors'), api('orders?limit=200')]);
    appState.monitors = data.monitors;
    for (const order of orderData.orders) {
      if (order.status === 'created' && order.payment_url) orderUrls[`${order.monitor_id}|${order.number}`] = order.payment_url;
    }
    appState.connected = true;
    setMonitorDefaults();
    await search(true);
  } catch (error) { notify(error.message, 'error'); }
}

async function search(silent = false) {
  loading.value = true;
  try {
    const data = await api('numbers/search', {
      method: 'POST',
      body: JSON.stringify({ query: form.query.trim(), minPrice: form.minPrice === '' ? null : form.minPrice, maxPrice: form.maxPrice === '' ? null : form.maxPrice, currency: form.currency.trim(), limit: 200 }),
    });
    results.value = data.results;
    recommended.value = data.recommended;
    total.value = data.total;
    searchedAt.value = data.searchedAt;
    if (!silent) notify(`数据库查询完成，共匹配 ${data.total} 个号码。`);
  } catch (error) { notify(error.message, 'error'); }
  finally { loading.value = false; }
}

async function useRecommendation(item) {
  form.query = item.number;
  form.minPrice = null;
  form.maxPrice = null;
  await search();
  document.getElementById('search-results-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const selectedMonitor = computed(() => monitors.value.find((item) => item.id === form.monitorId) || null);

function paymentUrl(item) {
  if (!form.monitorId) return null;
  return orderUrls[`${form.monitorId}|${item.number}`] || null;
}

function requestManualOrder(item) {
  if (!selectedMonitor.value) {
    notify('请先选择生成支付链接要使用的 esim.gg 账号。', 'error');
    return;
  }
  if (!selectedMonitor.value?.action?.enabled) {
    notify('请先在监控任务中启用“自动创建待支付订单”配置。', 'error');
    return;
  }
  manualOrderTarget.value = item;
}

async function confirmManualOrder(coupon = 'setup') {
  const item = manualOrderTarget.value;
  const monitor = selectedMonitor.value;
  if (!item || !monitor) return;
  creatingManualOrder.value = true;
  try {
    const data = await api(`monitors/${encodeURIComponent(monitor.id)}/numbers/order`, {
      method: 'POST',
      body: JSON.stringify({ number: item.number, expectedPrice: item.price, coupon, acknowledged: true }),
    });
    orderUrls[`${monitor.id}|${item.number}`] = data.order.paymentUrl;
    manualOrderTarget.value = null;
    notify(data.reused ? '已找到这个号码现有的支付链接。' : '支付链接已生成。');
    if (data.emailSent === false) notify(`链接已生成，但邮件发送失败：${data.emailError || '未知错误'}`, 'error');
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    creatingManualOrder.value = false;
  }
}

onMounted(loadMonitors);
</script>

<template>
  <div class="page-shell">
    <PageHero eyebrow="GLOBAL NUMBER CATALOG" title="号码查询" description="所有用户监控到的号码会汇总为一份全站共享目录，每个号码只保留最新价格。搜索不会请求 esim.gg，也不会自动创建订单。">
      <div class="live-chip active"><span></span><div><strong>全站共享目录</strong><small>号码去重 · 价格变化时更新</small></div></div>
    </PageHero>

    <section class="panel filter-panel" aria-labelledby="search-filter-title">
      <div class="panel-heading"><div><p class="eyebrow">FILTERS</p><h2 id="search-filter-title">查询条件</h2></div><StatusBadge>只读查询</StatusBadge></div>
      <div class="purchase-context">
        <div><strong>生成支付链接时使用的账号</strong><span>账号后的任务名称用于区分下单规则，不影响全站号码搜索结果。</span></div>
        <div class="field-control"><span class="field-label">esim.gg 账号</span><UiSelect v-model="form.monitorId" label="生成支付链接使用的 esim.gg 账号" :options="monitorOptions" /></div>
      </div>
      <form class="search-form" @submit.prevent="search()">
        <label>号码包含<input v-model.trim="form.query" inputmode="tel" maxlength="40" placeholder="例如 5319 或 +372" /></label>
        <label>最低价格<input v-model.number="form.minPrice" type="number" inputmode="decimal" min="0" step="0.01" placeholder="不限" /></label>
        <label>最高价格<input v-model.number="form.maxPrice" type="number" inputmode="decimal" min="0" step="0.01" placeholder="不限" /></label>
        <label>币种<input v-model.trim="form.currency" maxlength="3" placeholder="EUR" /></label>
        <button class="button button-primary" type="submit" :disabled="loading"><span v-if="loading" class="spinner" aria-hidden="true"></span>{{ loading ? '查询中…' : '搜索全站号码库' }}</button>
      </form>
      <p class="panel-helper">每个号码只保存一条最新价格，不记录由哪个任务发现，也不累计出现次数。相同价格的更新时间最多每天写入一次，以降低 D1 写入量。</p>
    </section>

    <section class="panel recommendations-panel" aria-labelledby="recommendations-title">
      <div class="panel-heading"><div><p class="eyebrow">SMART PICKS · LAST 7 DAYS</p><h2 id="recommendations-title">推荐号码</h2></div><small class="muted">免费优先 · 低价优先 · 最近更新优先</small></div>
      <div v-if="loading && !recommended.length" class="recommendation-grid" aria-label="正在加载推荐号码"><div v-for="item in 4" :key="item" class="recommendation-card skeleton-card"></div></div>
      <div v-else-if="!recommended.length" class="empty-state">全站号码库暂时没有近 7 天的可推荐号码，等待任意监控任务写入新数据。</div>
      <div v-else class="recommendation-grid">
        <article v-for="item in recommended" :key="item.number" class="recommendation-card" :class="{ free: Number(item.price) === 0 }">
          <div class="recommendation-head"><StatusBadge :tone="Number(item.price) === 0 ? 'success' : 'neutral'">{{ recommendationReason(item) }}</StatusBadge><span>{{ relativeTime(item.lastSeenAt) }}</span></div>
          <strong class="recommendation-number">{{ item.number }}</strong>
          <div class="recommendation-price"><span>折后号码费</span><b>{{ formatMoney(item.price, item.currency) }}</b></div>
          <div class="recommendation-meta"><span>全站共享目录</span><span>原价 {{ formatMoney(item.listedPrice, item.currency) }}</span></div>
          <button class="button button-secondary recommendation-action" type="button" @click="useRecommendation(item)">查看此号码记录</button>
        </article>
      </div>
    </section>

    <section class="metrics" aria-label="查询概览">
      <MetricCard label="匹配号码" :value="total" :caption="total > results.length ? `显示前 ${results.length} 条` : '符合当前条件'" />
      <MetricCard label="最低号码费" :value="lowest" caption="按折后价格排序" />
      <MetricCard label="免费号码" :value="freeCount" caption="当前结果中的免费记录" accent />
    </section>

    <section class="panel search-results-panel" aria-labelledby="search-results-title">
      <div class="panel-heading"><div><p class="eyebrow">DATABASE RESULTS</p><h2 id="search-results-title">号码记录</h2></div><small class="muted">{{ searchedAt ? `查询于 ${formatDate(searchedAt)}` : '尚未查询' }}</small></div>
      <div class="table-wrap">
        <table class="mobile-card-table"><thead><tr><th>号码</th><th>接口原价</th><th>折后号码费</th><th>目录更新时间</th><th>币种</th><th>状态</th><th>购买</th></tr></thead>
          <tbody>
            <tr v-if="!results.length" class="mobile-table-empty"><td colspan="7" class="empty-state">{{ searchedAt ? '没有符合条件的号码。可以点击上方推荐，或缩短号码片段、放宽价格范围。' : '全站号码库正在等待监控任务写入数据。' }}</td></tr>
            <tr v-for="item in results" :key="item.number" :class="{ 'row-highlight': Number(item.price) === 0 }"><td data-label="号码"><strong class="mono">{{ item.number }}</strong></td><td data-label="接口原价">{{ formatMoney(item.listedPrice, item.currency) }}</td><td class="price-cell" data-label="折后号码费">{{ formatMoney(item.price, item.currency) }}</td><td data-label="目录更新时间"><span class="freshness">{{ relativeTime(item.lastSeenAt) }}</span><small>{{ formatDate(item.lastSeenAt) }}</small></td><td data-label="币种">{{ item.currency || '—' }}</td><td data-label="状态"><StatusBadge :tone="Number(item.price) === 0 ? 'success' : 'neutral'">{{ Number(item.price) === 0 ? '免费记录' : '付费记录' }}</StatusBadge></td><td data-label="购买"><a v-if="paymentUrl(item)" class="button button-small button-primary" :href="paymentUrl(item)" target="_blank" rel="noreferrer">去支付</a><button v-else class="button button-small button-secondary" type="button" @click="requestManualOrder(item)">生成支付链接</button></td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <ManualOrderDialog :open="Boolean(manualOrderTarget)" :item="manualOrderTarget" :monitor-name="selectedMonitor?.name" :account-label="selectedMonitor?.providerSessionLabel" :notify-email="selectedMonitor?.notifyEmail" :coupon="couponFromAction(selectedMonitor?.action)" :loading="creatingManualOrder" @cancel="manualOrderTarget = null" @confirm="confirmManualOrder" />
  </div>
</template>
