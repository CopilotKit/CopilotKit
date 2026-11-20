<script setup lang="ts">
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from "@copilotkit/vue/v2";
import type { VueHostConfiguration } from "../host-configuration";

defineProps<{
  configuration: VueHostConfiguration;
}>();
</script>

<template>
  <div class="feature-page" data-testid="vue-agentic-chat">
    <header class="feature-header">
      <div>
        <h1>Agentic Chat</h1>
        <p data-testid="showcase-cell-id">{{ configuration.cellId }}</p>
      </div>
      <span class="framework-badge">Vue</span>
    </header>
    <main class="chat-surface" aria-label="CopilotKit Vue demo">
      <CopilotKitProvider
        :runtime-url="configuration.runtimeUrl"
        public-license-key="ck_pub_00000000000000000000000000000000"
      >
        <CopilotChatConfigurationProvider
          :agent-id="configuration.agentId"
          :thread-id="configuration.threadId"
        >
          <CopilotChat
            :agent-id="configuration.agentId"
            :thread-id="configuration.threadId"
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </main>
  </div>
</template>
