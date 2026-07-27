<!-- @region[provider-auth-headers] -->
<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";

const getHeaders = () => ({
  Authorization: `Bearer ${sessionStorage.getItem("access_token") ?? ""}`,
});
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit"
    :headers="getHeaders"
    credentials="include"
  >
    <CopilotChat />
  </CopilotKitProvider>
</template>
<!-- @endregion[provider-auth-headers] -->
