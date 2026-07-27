<!-- @region[threads-drawer] -->
<script setup lang="ts">
import {
  CopilotChat,
  CopilotKitProvider,
  CopilotThreadsDrawer,
} from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <div class="chat-with-threads">
      <CopilotThreadsDrawer agent-id="default" />
      <CopilotChat agent-id="default" />
    </div>
  </CopilotKitProvider>
</template>
<!-- @endregion[threads-drawer] -->
