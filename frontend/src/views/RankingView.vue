<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import MetricCard from '../components/MetricCard.vue';
import PageHero from '../components/PageHero.vue';
import StatusBadge from '../components/StatusBadge.vue';
import UiSelect from '../components/UiSelect.vue';
import { api, formatDate, formatMoney, notify } from '../lib/session';

const filters = reactive({ order: 'asc' });
const entries = ref([]);
const stats = reactive({ total: 0, freeCount: 0, lowestPrice: null, latestSeenAt: null });
const generatedAt = ref(null);
const loading = ref(false);
const orderOptions = [
  { value: 'asc', label: '低价优先' },
  { value: 'desc', label: '高价优先' },
];
const rankingTitle = computed(() => filters.order === 'asc' ? '低价号码榜' : '高价号码榜');
const currency = computed(() => entries.value.find((item) => item.currency)?.currency || 'EUR');

function relativeTime(value) {
  if (!value) return '尚无记录';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return '刚刚出现';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

async function loadRanking() {
  loading.value = true;
  try {
    const params = new URLSearchParams({ order: filters.order, limit: '100' });
    const data = await api(`numbers/ranking?${params}`);
    entries.value = data.entries;
    Object.assign(stats, data.stats);
    generatedAt.value = data.generatedAt;
  } catch (error) {
    notify(error.message, 'error');
  } finally {
    loading.value = false;
  }
}

async function loadPage() {
  await loadRanking();
}

onMounted(loadPage);
</script>

<template>
  <div class="page-shell ranking-page">
    <PageHero eyebrow="GLOBAL PRICE LEADERBOARD" title="价格排行榜" description="汇总所有用户监控到的号码，每个号码只保留一条最新价格，不记录来源任务和出现次数。这里只读取共享 D1 目录，不会请求 esim.gg 或创建订单。">
      <div class="live-chip active"><span></span><div><strong>全站共享目录</strong><small>{{ stats.latestSeenAt ? `更新于 ${relativeTime(stats.latestSeenAt)}` : '等待监控写入数据' }}</small></div></div>
    </PageHero>

    <section class="panel ranking-filter-panel" aria-labelledby="ranking-filter-title">
      <div class="panel-heading"><div><p class="eyebrow">RANKING SCOPE</p><h2 id="ranking-filter-title">排行榜范围</h2></div><StatusBadge>只读统计</StatusBadge></div>
      <div class="ranking-toolbar">
        <div class="field-control"><span class="field-label">排序方式</span><UiSelect v-model="filters.order" label="选择价格排序方式" :options="orderOptions" @change="loadRanking" /></div>
        <button class="button button-secondary" type="button" :disabled="loading" @click="loadRanking"><span v-if="loading" class="spinner" aria-hidden="true"></span>{{ loading ? '刷新中…' : '刷新榜单' }}</button>
      </div>
      <p class="panel-helper">未知价格不会进入榜单；当前最多展示前 100 个号码。相同价格的目录时间最多每天刷新一次，价格变化会立即更新。</p>
    </section>

    <section class="metrics" aria-label="排行榜概览">
      <MetricCard label="全站收录号码" :value="stats.total" caption="每个号码仅保留一条" />
      <MetricCard label="最低号码费" :value="formatMoney(stats.lowestPrice, currency)" caption="按最近一次价格统计" />
      <MetricCard label="免费号码" :value="stats.freeCount" caption="最近价格为零的号码" accent />
    </section>

    <section class="panel ranking-panel" aria-labelledby="ranking-title">
      <div class="panel-heading"><div><p class="eyebrow">TOP 100 · CURRENT PRICE</p><h2 id="ranking-title">{{ rankingTitle }}</h2></div><small class="muted">{{ generatedAt ? `生成于 ${formatDate(generatedAt)}` : '正在读取榜单' }}</small></div>
      <div v-if="loading && !entries.length" class="ranking-skeleton" aria-label="正在加载号码价格排行榜"><div v-for="item in 6" :key="item" class="skeleton-card"></div></div>
      <div v-else-if="!entries.length" class="ranking-empty empty-state"><strong>还没有可排名的号码</strong><span>先创建并运行一次监控任务，号码与价格写入 D1 后会自动出现在这里。</span><RouterLink class="button button-secondary" to="/dashboard">前往监控台</RouterLink></div>
      <template v-else>
        <div class="ranking-list-head" aria-hidden="true"><span>名次</span><span>号码</span><span>号码费</span><span>状态</span><span>目录更新时间</span></div>
        <ol class="ranking-list" :aria-label="rankingTitle">
          <li v-for="(item, index) in entries" :key="item.number" class="ranking-row" :class="{ 'ranking-top': index < 3, 'ranking-free': Number(item.price) === 0 }">
            <div class="ranking-position"><span>排名</span><strong>#{{ String(index + 1).padStart(2, '0') }}</strong></div>
            <div class="ranking-number"><strong class="mono">{{ item.number }}</strong><span>全站共享号码目录</span></div>
            <div class="ranking-price"><strong>{{ formatMoney(item.price, item.currency) }}</strong><span>原价 {{ formatMoney(item.listedPrice, item.currency) }}</span></div>
            <div class="ranking-source"><StatusBadge :tone="Number(item.price) === 0 ? 'success' : 'neutral'">{{ Number(item.price) === 0 ? '免费' : '付费' }}</StatusBadge></div>
            <div class="ranking-freshness"><strong>{{ relativeTime(item.lastSeenAt) }}</strong><span>{{ formatDate(item.lastSeenAt) }}</span></div>
          </li>
        </ol>
      </template>
    </section>
  </div>
</template>
