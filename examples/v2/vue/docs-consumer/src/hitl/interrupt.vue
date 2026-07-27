<!-- @region[interrupt-handling] -->
<script setup lang="ts">
import { CopilotChat, useInterrupt } from "@copilotkit/vue/v2";

const { slotProps } = useInterrupt({
  agentId: "default",
  renderInChat: false,
});
</script>

<template>
  <CopilotChat agent-id="default" />
  <section v-if="slotProps?.interrupt" role="alert">
    <p>
      {{ slotProps.interrupt.message ?? slotProps.interrupt.reason }}
    </p>
    <p v-if="slotProps.interrupts.length > 1">
      {{ slotProps.interrupts.length }} decisions require a response.
    </p>
    <button
      type="button"
      @click="slotProps.resolve({ approved: true }, slotProps.interrupt.id)"
    >
      Approve
    </button>
    <button type="button" @click="slotProps.cancel(slotProps.interrupt.id)">
      Cancel
    </button>
  </section>
</template>
<!-- @endregion[interrupt-handling] -->
