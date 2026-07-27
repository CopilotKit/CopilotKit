<!-- @region[self-managed-agent-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider, HttpAgent } from "@copilotkit/vue/v2";

const supportAgent = new HttpAgent({
  url: "https://agents.example.com/support",
});
</script>

<template>
  <CopilotKitProvider :self-managed-agents="{ 'support-agent': supportAgent }">
    <CopilotChat agent-id="support-agent" />
  </CopilotKitProvider>
</template>
<!-- @endregion[self-managed-agent-provider] -->
