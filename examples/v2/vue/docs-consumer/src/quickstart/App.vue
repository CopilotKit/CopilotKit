<!-- @region[provider-chat-app] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="http://localhost:4000/api/copilotkit">
    <main class="app-shell">
      <CopilotChat agent-id="default" />
    </main>
  </CopilotKitProvider>
</template>
<!-- @endregion[provider-chat-app] -->
