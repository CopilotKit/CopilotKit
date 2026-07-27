<!-- @region[threads-drawer] -->
<script setup lang="ts">
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <CopilotChatConfigurationProvider agent-id="default">
      <div class="chat-with-threads">
        <CopilotThreadsDrawer />
        <CopilotChat />
      </div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
</template>
<!-- @endregion[threads-drawer] -->
