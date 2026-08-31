<script setup>
import { toastState, dismissToast } from '../lib/session';
</script>

<template>
  <div class="toast-stack" aria-live="polite" aria-atomic="false">
    <TransitionGroup name="toast">
      <div v-for="toast in toastState.items" :key="toast.id" class="toast" :class="`toast-${toast.type}`" role="status">
        <span class="toast-mark" aria-hidden="true">{{ toast.type === 'error' ? '!' : '✓' }}</span>
        <span>{{ toast.message }}</span>
        <button class="toast-close" type="button" aria-label="关闭提示" @click="dismissToast(toast.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>
