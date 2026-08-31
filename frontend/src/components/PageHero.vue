<script setup>
defineProps({ eyebrow: String, title: String, description: String });
</script>

<template>
  <section class="page-hero">
    <div>
      <p class="eyebrow accent">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <slot />
  </section>
</template>
