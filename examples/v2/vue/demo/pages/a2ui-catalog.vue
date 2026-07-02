<script setup lang="ts">
import {
  CopilotChat,
  CopilotKitProvider,
  vueBasicCatalog,
} from "@copilotkit/vue";

// Catalog-on-provider path (#5774): the runtime at /api/copilotkit-catalog has
// NO a2ui config. A2UI must switch on purely because we pass a catalog here,
// which also forwards `a2uiCatalogAvailable` to the runtime.
</script>

<template>
  <CopilotKitProvider
    runtime-url="/api/copilotkit-catalog"
    :a2ui="{ catalog: vueBasicCatalog }"
    show-dev-console="auto"
  >
    <div style="height: 100vh; margin: 0; padding: 0; overflow: hidden">
      <CopilotChat agent-id="demo-button" thread-id="a2ui-catalog-thread" />
    </div>
  </CopilotKitProvider>
</template>
