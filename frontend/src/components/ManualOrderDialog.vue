<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { formatDate, formatMoney } from '../lib/session';

const props = defineProps({
  open: Boolean,
  item: { type: Object, default: null },
  monitorName: { type: String, default: '' },
  accountLabel: { type: String, default: '' },
  notifyEmail: { type: String, default: '' },
  coupon: { type: String, default: 'setup' },
  loading: Boolean,
});
const emit = defineEmits(['cancel', 'confirm']);
const dialog = ref(null);
const orderCoupon = ref('setup');
const lastSeenAt = computed(() => props.item?.lastSeenAt || props.item?.last_seen_at || props.item?.first_seen_at || null);

watch(() => props.open, async (open) => {
  if (open) orderCoupon.value = props.coupon;
  await nextTick();
  if (open && !dialog.value?.open) dialog.value?.showModal();
  if (!open && dialog.value?.open) dialog.value.close();
}, { immediate: true });

function cancel(event) {
  if (props.loading) {
    event?.preventDefault?.();
    return;
  }
  emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="confirm-dialog manual-order-dialog" aria-labelledby="manual-order-title" aria-describedby="manual-order-description" @click.self="cancel" @cancel="cancel" @close="!loading && emit('cancel')">
      <div class="confirm-dialog-card">
        <div class="confirm-dialog-icon order-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16v11H4zM7 4h10v3M8 12h8m-8 3h5" /></svg></div>
        <div class="confirm-dialog-copy">
          <p class="eyebrow">CREATE UNPAID ORDER</p>
          <h2 id="manual-order-title">为这个号码生成支付链接？</h2>
          <p id="manual-order-description">Worker 将使用你绑定的 esim.gg 账号创建一笔待支付订单，并把 Stripe 链接发送到通知邮箱。不会自动付款。</p>
        </div>
        <dl class="manual-order-summary">
          <div><dt>号码</dt><dd class="mono">{{ item?.number }}</dd></div>
          <div><dt>最近号码费</dt><dd>{{ formatMoney(item?.price, item?.currency) }}</dd></div>
          <div><dt>监控任务</dt><dd>{{ monitorName || '—' }}</dd></div>
          <div><dt>esim.gg 账号</dt><dd>{{ accountLabel || '未指定' }}</dd></div>
          <div><dt>通知邮箱</dt><dd>{{ notifyEmail || '—' }}</dd></div>
          <div><dt>最近出现</dt><dd>{{ formatDate(lastSeenAt) }}</dd></div>
        </dl>
        <label class="manual-order-coupon" for="manual-order-coupon">优惠码
          <input id="manual-order-coupon" v-model.trim="orderCoupon" :disabled="loading" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="manual-order-coupon-help" />
          <small id="manual-order-coupon-help"><code>setup</code> 可减 €0.40；可修改或清空，最终优惠以 Stripe 页面为准。</small>
        </label>
        <p class="manual-order-warning">这是手动操作，不受任务的自动下单价格上限约束。号码可能已被他人购买；最终价格和订单内容以 Stripe 支付页面为准。</p>
        <div class="confirm-dialog-actions">
          <button class="button button-secondary" type="button" :disabled="loading" autofocus @click="cancel">取消</button>
          <button class="button button-primary" type="button" :disabled="loading" @click="emit('confirm', orderCoupon)"><span v-if="loading" class="spinner" aria-hidden="true"></span>{{ loading ? '正在生成…' : '确认生成链接' }}</button>
        </div>
      </div>
    </dialog>
  </Teleport>
</template>
