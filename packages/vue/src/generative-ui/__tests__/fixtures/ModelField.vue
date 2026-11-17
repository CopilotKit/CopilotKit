<script setup lang="ts">
// A generated component with a writable `value`, written the Vue way.
defineProps<{ label?: string }>();
const value = defineModel<string>("value", { required: true });
</script>

<template>
  <input v-model="value" :aria-label="label ?? 'model'" />
</template>
