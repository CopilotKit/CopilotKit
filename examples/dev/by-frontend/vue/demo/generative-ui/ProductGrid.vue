<script setup lang="ts">
// A grid of product cards. The renderer fills the `children` slot with one
// node for each child id the agent sends.
defineProps<{ title?: string }>();
</script>

<template>
  <section class="space-y-3">
    <h3 v-if="title" class="text-sm font-semibold text-gray-700">
      {{ title }}
    </h3>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <slot name="children" />
    </div>
  </section>
</template>
