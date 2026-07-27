<!-- @region[interrupt-handling] -->
<script setup lang="ts">
import { CopilotChat, useInterrupt } from "@copilotkit/vue/v2";

const { hasInterrupt, interrupt, result, resolve } = useInterrupt<
  { action: string },
  { label: string }
>({
  handler: ({ event }) => ({
    label: `Approve ${event.value.action}?`,
  }),
});
</script>

<template>
  <CopilotChat />
  <div v-if="hasInterrupt && interrupt" role="alert">
    <p>{{ result?.label ?? `Approve ${interrupt.value.action}?` }}</p>
    <button type="button" @click="resolve({ approved: true })">Approve</button>
  </div>
</template>
<!-- @endregion[interrupt-handling] -->
