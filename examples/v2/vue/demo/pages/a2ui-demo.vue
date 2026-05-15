<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue";
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :a2ui="{}"
    show-dev-console="auto"
  >
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <CopilotChat agent-id="demo-button" thread-id="a2ui-demo-thread" />
    </div>
  </CopilotKitProvider>
</template>
