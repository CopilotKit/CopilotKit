<!-- @region[provider-chat-error-handling] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";

interface CopilotErrorEvent {
  error: Error;
  code: string;
  context: Record<string, unknown>;
}

function reportApplicationError(event: CopilotErrorEvent) {
  console.error(
    `[CopilotKit ${event.code}]`,
    event.error.message,
    event.context,
  );
}

function reportChatError(event: CopilotErrorEvent) {
  console.error(`Support chat error: ${event.error.message}`);
}
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :on-error="reportApplicationError"
  >
    <CopilotChat agent-id="support" :on-error="reportChatError" />
  </CopilotKitProvider>
</template>
<!-- @endregion[provider-chat-error-handling] -->
