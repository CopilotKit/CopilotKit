<!-- @region[mcp-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";

const properties = {
  mcpServers: [
    {
      endpoint: "https://your-mcp-server.example/sse",
    },
  ],
};
</script>

<template>
  <CopilotKitProvider
    runtime-url="http://localhost:4000/api/copilotkit"
    :properties="properties"
  >
    <CopilotChat agent-id="default" />
  </CopilotKitProvider>
</template>
<!-- @endregion[mcp-provider] -->
