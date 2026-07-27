<!-- @region[nuxt-provider-chat] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
</script>

<template>
  <CopilotKitProvider runtime-url="http://localhost:4000/api/copilotkit">
    <CopilotChat agent-id="default" />
  </CopilotKitProvider>
</template>
<!-- @endregion[nuxt-provider-chat] -->
