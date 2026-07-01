<script setup lang="ts">
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit" show-dev-console="auto">
    <CopilotChatConfigurationProvider>
      <div style="display: flex; height: 100vh">
        <!-- Client-only: the element is not registered during SSR. -->
        <ClientOnly>
          <CopilotThreadsDrawer />
        </ClientOnly>
        <div style="flex: 1; min-width: 0">
          <CopilotChat />
        </div>
      </div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
</template>
