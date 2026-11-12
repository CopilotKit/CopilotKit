<script setup lang="ts">
import { computed } from "vue";

// Debug only. With `crash`, it throws while it renders, so the page shows
// that one failing component does not break the rest of the surface.
const props = defineProps<{ label: string; crash?: boolean }>();

const text = computed(() => {
  if (props.crash)
    throw new Error(`DiagnosticWidget "${props.label}" crashed on purpose`);
  return `Diagnostic: ${props.label}`;
});
</script>

<template>
  <div class="rounded border border-dashed p-2 text-xs text-gray-500">
    {{ text }}
  </div>
</template>
