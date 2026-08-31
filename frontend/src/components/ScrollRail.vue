<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

const rail = ref(null);
const visible = ref(false);
const scrollable = ref(false);
const dragging = ref(false);
const thumbHeight = ref(34);
const thumbTop = ref(0);
const maxScroll = ref(0);
let revealTimer = 0;
let resizeObserver;
let dragStartY = 0;
let dragStartTop = 0;

const thumbStyle = computed(() => ({
  height: `${thumbHeight.value}px`,
  transform: `translateY(${thumbTop.value}px)`,
}));

function clearRevealTimer() {
  window.clearTimeout(revealTimer);
  revealTimer = 0;
}

function updateMetrics() {
  const root = document.documentElement;
  const trackHeight = rail.value?.clientHeight || 0;
  maxScroll.value = Math.max(0, root.scrollHeight - window.innerHeight);
  scrollable.value = maxScroll.value > 1 && trackHeight > 0;
  if (!scrollable.value) {
    visible.value = false;
    return;
  }

  thumbHeight.value = Math.min(trackHeight, Math.max(34, (window.innerHeight / root.scrollHeight) * trackHeight));
  const available = Math.max(0, trackHeight - thumbHeight.value);
  thumbTop.value = maxScroll.value ? (window.scrollY / maxScroll.value) * available : 0;
}

function handlePointerMove(event) {
  if (dragging.value) return;
  const isNearRightEdge = window.innerWidth - event.clientX <= 20;
  if (!isNearRightEdge || !scrollable.value) {
    clearRevealTimer();
    visible.value = false;
    return;
  }
  if (visible.value || revealTimer) return;
  revealTimer = window.setTimeout(() => {
    revealTimer = 0;
    if (scrollable.value) visible.value = true;
  }, 500);
}

function beginDrag(event) {
  event.preventDefault();
  dragging.value = true;
  visible.value = true;
  dragStartY = event.clientY;
  dragStartTop = thumbTop.value;
  document.addEventListener('pointermove', drag);
  document.addEventListener('pointerup', endDrag, { once: true });
}

function drag(event) {
  const available = Math.max(0, (rail.value?.clientHeight || 0) - thumbHeight.value);
  const nextTop = Math.min(available, Math.max(0, dragStartTop + event.clientY - dragStartY));
  const nextScroll = available ? (nextTop / available) * maxScroll.value : 0;
  window.scrollTo({ top: nextScroll, behavior: 'auto' });
}

function endDrag() {
  dragging.value = false;
  document.removeEventListener('pointermove', drag);
}

function handleKeydown(event) {
  const steps = {
    ArrowUp: -80,
    ArrowDown: 80,
    PageUp: -window.innerHeight * 0.8,
    PageDown: window.innerHeight * 0.8,
  };
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    window.scrollTo({ top: event.key === 'Home' ? 0 : maxScroll.value, behavior: 'smooth' });
  } else if (event.key in steps) {
    event.preventDefault();
    window.scrollBy({ top: steps[event.key], behavior: 'smooth' });
  }
}

onMounted(() => {
  updateMetrics();
  window.addEventListener('scroll', updateMetrics, { passive: true });
  window.addEventListener('resize', updateMetrics, { passive: true });
  document.addEventListener('pointermove', handlePointerMove, { passive: true });
  resizeObserver = new ResizeObserver(updateMetrics);
  resizeObserver.observe(document.body);
});

onBeforeUnmount(() => {
  clearRevealTimer();
  resizeObserver?.disconnect();
  window.removeEventListener('scroll', updateMetrics);
  window.removeEventListener('resize', updateMetrics);
  document.removeEventListener('pointermove', handlePointerMove);
  document.removeEventListener('pointermove', drag);
});
</script>

<template>
  <div
    ref="rail"
    class="scroll-rail"
    :class="{ 'scroll-rail-visible': visible, 'scroll-rail-dragging': dragging }"
    :aria-hidden="!visible"
  >
    <button
      v-if="scrollable"
      class="scroll-rail-thumb"
      type="button"
      role="scrollbar"
      aria-label="页面滚动条"
      aria-orientation="vertical"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(maxScroll)"
      :aria-valuenow="Math.round(Math.min(maxScroll, Math.max(0, typeof window === 'undefined' ? 0 : window.scrollY)))"
      :tabindex="visible ? 0 : -1"
      :style="thumbStyle"
      @pointerdown="beginDrag"
      @keydown="handleKeydown"
    ></button>
  </div>
</template>
