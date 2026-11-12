<script setup lang="ts">
import { CopilotChat, CopilotKitProvider } from "@copilotkit/vue/v2";
import { standardUI } from "@copilotkit/vue/v2/generative-ui";

// Catalog-on-provider path: the runtime at /api/copilotkit-catalog has NO
// generativeUI config. Generative UI must switch on purely because we pass a
// UI here, which sends the catalog to the runtime with each run.
const generativeUI = { ui: standardUI };
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit-catalog"
    :generativeUI="generativeUI"
  >
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <CopilotChat agent-id="demo-button" thread-id="a2ui-catalog-thread" />
    </div>
  </CopilotKitProvider>
</template>
