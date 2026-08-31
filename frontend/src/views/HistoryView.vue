<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import MetricCard from '../components/MetricCard.vue';
import PageHero from '../components/PageHero.vue';
import StatusBadge from '../components/StatusBadge.vue';
import UiSelect from '../components/UiSelect.vue';
import { loadLocalCheckHistory } from '../lib/history';
import { api, appState, formatDate, formatMoney, notify } from '../lib/session';

const filters = reactive({ monitorId: '', limit: 20 });
const storedHistory = ref([]);
const loading = ref(false);
const monitors = computed(() => appState.monitors);
const history = computed(() => storedHistory.value
  .filter((run) => !filters.monitorId || run.monitor_id === filters.monitorId)
  .slice(0, Number(filters.limit)));
const monitorOptions = computed(() => [{ value: '', label: '全部任务' }, ...monitors.value.map((monitor) => ({ value: monitor.id, label: monitor.name }))]);
const limitOptions = [{ value: 10, label: '最近 10 次' }, { value: 20, label: '最近 20 次' }, { value: 50, label: '最近 50 次' }];
const totalResults = computed(() => history.value.reduce((sum, run) => sum + run.results.length, 0));
const totalMatches = computed(() => history.value.reduce((sum, run) => sum + run.results.filter((item) => item.matched).length, 0));

async function load() {
  if (!appState.user) return false;
  loading.value = true;
  try {
    const monitorRequest = monitors.value.length ? Promise.resolve({ monitors: monitors.value }) : api('monitors');
    const { monitors: loadedMonitors } = await monitorRequest;
    appState.monitors = loadedMonitors;
    appState.connected = true;
    storedHistory.value = loadLocalCheckHistory(appState.user?.id);
    return true;
  } catch (error) { notify(error.message, 'error'); return false; }
  finally { loading.value = false; }
}

async function refresh() { if (await load()) notify('查询历史已刷新。'); }
onMounted(load);
</script>

<template>
  <div class="page-shell">
    <PageHero eyebrow="LOCAL QUERY ARCHIVE" title="本机历史" description="点击“立即检查”后，逐轮号码结果只保存在当前浏览器，最多 50 次并自动清理 7 天前的数据；后台 Cron 不保存逐轮历史。">
      <div class="hero-controls">
        <div class="field-control"><span class="field-label">监控任务</span><UiSelect v-model="filters.monitorId" label="监控任务" :options="monitorOptions" @change="load" /></div>
        <div class="field-control"><span class="field-label">显示批次</span><UiSelect v-model="filters.limit" label="显示批次" :options="limitOptions" @change="load" /></div>
        <button class="button button-secondary" type="button" :disabled="loading" @click="refresh"><span v-if="loading" class="spinner" aria-hidden="true"></span>{{ loading ? '加载中…' : '刷新历史' }}</button>
      </div>
    </PageHero>

    <p class="browser-history-note"><strong>仅本机保存</strong><span>换浏览器、换设备或清理网站数据后历史会消失。号码、价格和任务名称会保存在浏览器中，但不会同步到 D1。</span></p>

    <section class="metrics" aria-label="历史概览">
      <MetricCard label="查询批次" :value="history.length" caption="当前加载" />
      <MetricCard label="返回号码" :value="totalResults" caption="包含重复轮次" />
      <MetricCard label="符合条件" :value="totalMatches" caption="符合任务价格规则" accent />
    </section>

    <section class="history-list" aria-label="查询批次">
      <div v-if="loading && !history.length" class="skeleton-stack" aria-label="正在加载查询历史"><div v-for="item in 3" :key="item" class="panel skeleton-card"></div></div>
      <div v-else-if="!history.length" class="panel empty-state">还没有当前筛选范围内的本地历史。回到监控台点击“立即检查”后会保存在这里。</div>
      <article v-for="(run, index) in history" :key="run.id" class="panel history-run">
        <header class="run-heading">
          <div><p class="eyebrow">{{ run.monitor_name }}</p><h2>{{ formatDate(run.started_at) }}</h2></div>
          <div class="run-summary"><StatusBadge :tone="run.status === 'success' ? 'success' : run.status === 'error' ? 'danger' : 'neutral'">{{ run.status }}</StatusBadge><span>{{ run.rounds }} 轮</span><span>{{ run.candidate_count }} 个号码</span><span>{{ run.matched_count }} 个命中</span></div>
        </header>
        <p v-if="run.error" class="run-error">{{ run.error }}</p>
        <details :open="index === 0"><summary>查看 {{ run.results.length }} 条号码结果</summary>
          <div class="table-wrap"><table class="mobile-card-table"><thead><tr><th>轮次</th><th>手机号</th><th>接口原价</th><th>折后号码费</th><th>结果</th></tr></thead>
            <tbody><tr v-for="(item, resultIndex) in run.results" :key="`${item.round_number}-${item.number}-${resultIndex}`" :class="{ 'row-highlight': item.matched }"><td data-label="轮次">{{ item.round_number }}</td><td data-label="手机号"><strong class="mono">{{ item.number }}</strong></td><td data-label="接口原价">{{ formatMoney(item.listed_price, item.currency) }}</td><td class="price-cell" data-label="折后号码费">{{ formatMoney(item.price, item.currency) }}</td><td data-label="结果"><StatusBadge :tone="item.matched ? 'success' : 'neutral'">{{ item.matched ? '符合条件' : '未命中' }}</StatusBadge></td></tr></tbody>
          </table></div>
        </details>
      </article>
    </section>
  </div>
</template>
