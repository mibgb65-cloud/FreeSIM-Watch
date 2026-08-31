<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  options: { type: Array, default: () => [] },
  label: { type: String, required: true },
  disabled: Boolean,
});
const emit = defineEmits(['update:modelValue', 'change']);
const root = ref(null);
const trigger = ref(null);
const optionElements = ref([]);
const open = ref(false);
const activeIndex = ref(-1);
const listboxId = `select-${crypto.randomUUID()}`;
const selectedIndex = computed(() => props.options.findIndex((option) => option.value === props.modelValue));
const selected = computed(() => props.options[selectedIndex.value] || null);

function enabledIndex(start, direction) {
  if (!props.options.length) return -1;
  let index = start;
  for (let count = 0; count < props.options.length; count += 1) {
    index = (index + direction + props.options.length) % props.options.length;
    if (!props.options[index]?.disabled) return index;
  }
  return -1;
}

async function openMenu(direction = 1) {
  if (props.disabled) return;
  open.value = true;
  activeIndex.value = selectedIndex.value >= 0 && !props.options[selectedIndex.value]?.disabled
    ? selectedIndex.value
    : enabledIndex(direction > 0 ? -1 : 0, direction);
  await nextTick();
  optionElements.value[activeIndex.value]?.focus();
}

function closeMenu(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) nextTick(() => trigger.value?.focus());
}

function choose(option) {
  if (option.disabled) return;
  emit('update:modelValue', option.value);
  emit('change', option.value);
  closeMenu();
}

function move(direction) {
  const next = enabledIndex(activeIndex.value, direction);
  if (next < 0) return;
  activeIndex.value = next;
  nextTick(() => optionElements.value[next]?.focus());
}

function handleTriggerKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openMenu(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    open.value ? closeMenu() : openMenu();
  }
}

function handleOptionKeydown(event, option) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    activeIndex.value = enabledIndex(event.key === 'Home' ? -1 : 0, event.key === 'Home' ? 1 : -1);
    nextTick(() => optionElements.value[activeIndex.value]?.focus());
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    choose(option);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu();
  } else if (event.key === 'Tab') {
    open.value = false;
  }
}

function handleOutside(event) {
  if (open.value && !root.value?.contains(event.target)) closeMenu(false);
}

onMounted(() => document.addEventListener('pointerdown', handleOutside));
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutside));
</script>

<template>
  <div ref="root" class="ui-select" :class="{ open, disabled }">
    <button ref="trigger" class="ui-select-trigger" type="button" :disabled="disabled" :aria-label="label" aria-haspopup="listbox" :aria-expanded="open" :aria-controls="listboxId" @click="open ? closeMenu() : openMenu()" @keydown="handleTriggerKeydown">
      <span :class="{ placeholder: !selected || selected.disabled }">{{ selected?.label || '请选择' }}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
    </button>
    <Transition name="select-menu">
      <ul v-if="open" :id="listboxId" class="ui-select-menu" role="listbox" :aria-label="label">
        <li v-for="(option, index) in options" :id="`${listboxId}-${index}`" :key="`${option.value}-${index}`" :ref="(element) => { if (element) optionElements[index] = element }" class="ui-select-option" :class="{ selected: option.value === modelValue, active: index === activeIndex, disabled: option.disabled }" role="option" :aria-selected="option.value === modelValue" :aria-disabled="option.disabled || undefined" :tabindex="index === activeIndex ? 0 : -1" @click="choose(option)" @mouseenter="!option.disabled && (activeIndex = index)" @keydown="handleOptionKeydown($event, option)">{{ option.label }}<span v-if="option.value === modelValue" class="ui-select-check" aria-hidden="true"></span></li>
      </ul>
    </Transition>
  </div>
</template>
