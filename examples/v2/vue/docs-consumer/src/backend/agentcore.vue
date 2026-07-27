<!-- @region[agentcore-provider-chat] -->
<script setup lang="ts">
import { CopilotKitProvider, CopilotSidebar } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <main>
      <h1>AgentCore assistant</h1>
      <CopilotSidebar agent-id="my_agent" />
    </main>
  </CopilotKitProvider>
</template>
<!-- @endregion[agentcore-provider-chat] -->
