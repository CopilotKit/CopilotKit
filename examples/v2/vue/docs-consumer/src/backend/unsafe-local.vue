<!-- @region[unsafe-local-agent-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider, HttpAgent } from "@copilotkit/vue/v2";

const localAgent = new HttpAgent({
  url: "http://localhost:8000",
});
</script>

<template>
  <CopilotKitProvider :agents__unsafe_dev_only="{ 'local-agent': localAgent }">
    <CopilotChat agent-id="local-agent" />
  </CopilotKitProvider>
</template>
<!-- @endregion[unsafe-local-agent-provider] -->
