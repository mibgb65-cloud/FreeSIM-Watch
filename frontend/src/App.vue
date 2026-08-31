<script setup>
import { useRoute } from 'vue-router';
import AppShell from './components/AppShell.vue';

const route = useRoute();
</script>

<template>
  <RouterView v-slot="{ Component }">
    <Transition v-if="route.meta.public" name="route" mode="out-in" appear>
      <component :is="Component" :key="route.name" />
    </Transition>
    <AppShell v-else>
      <Transition name="route" mode="out-in" appear>
        <component :is="Component" :key="route.name" />
      </Transition>
    </AppShell>
  </RouterView>
</template>
