<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";

// No `generativeUI` prop: the runtime at /api/copilotkit turns generative UI
// on, so the provider renders the agent's A2UI surface with the standard
// catalog.
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <CopilotChat agent-id="demo-button" thread-id="a2ui-demo-thread" />
    </div>
  </CopilotKitProvider>
</template>
