<!-- @region[localhost-inspector-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" show-dev-console="auto">
    <CopilotChat />
  </CopilotKitProvider>
</template>
<!-- @endregion[localhost-inspector-provider] -->
