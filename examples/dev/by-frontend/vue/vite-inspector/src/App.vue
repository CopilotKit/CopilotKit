<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue";
</script>

<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <div class="app">
      <p class="note">
        Vite + Vue CopilotKit. Inspector must appear in the corner. Chat has no
        runtime on this page.
      </p>
      <div class="chat">
        <CopilotChat />
      </div>
    </div>
  </CopilotKitProvider>
</template>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
}

.note {
  margin: 0;
  padding: 12px 16px;
  font-family: system-ui, sans-serif;
  font-size: 14px;
}

.chat {
  flex: 1;
  min-height: 0;
}
</style>
