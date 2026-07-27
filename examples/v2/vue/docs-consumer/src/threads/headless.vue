<!-- @region[headless-threads-composition] -->
<script setup lang="ts">
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/vue/v2";
import HeadlessThreadList from "./HeadlessThreadList.vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <CopilotChatConfigurationProvider agent-id="default">
      <div class="chat-with-custom-threads">
        <HeadlessThreadList />
        <CopilotChat />
      </div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
</template>
<!-- @endregion[headless-threads-composition] -->
