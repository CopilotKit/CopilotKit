<!-- @region[inspector-debug-provider] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    show-dev-console
    :debug="{ events: true, lifecycle: true, verbose: false }"
    :inspector-default-anchor="{ horizontal: 'right', vertical: 'bottom' }"
  >
    <CopilotChat />
  </CopilotKitProvider>
</template>
<!-- @endregion[inspector-debug-provider] -->
