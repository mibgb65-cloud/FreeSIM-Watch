<script setup>
defineProps({ label: String, value: [String, Number], caption: String, accent: Boolean });
</script>

<template>
  <article class="metric-card" :class="{ 'metric-accent': accent }">
    <span class="metric-label">{{ label }}</span>
    <strong>{{ value }}</strong>
    <small>{{ caption }}</small>
  </article>
</template>
