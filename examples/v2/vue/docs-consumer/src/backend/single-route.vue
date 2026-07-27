<!-- @region[single-route-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" use-single-endpoint>
    <CopilotChat agent-id="default" />
  </CopilotKitProvider>
</template>
<!-- @endregion[single-route-provider] -->
