<script setup lang="ts">
/**
 * V1 compatibility wrapper for CopilotKitProvider.
 *
 * Accepts the same props as CopilotKitProvider plus legacy v1 props
 * (publicApiKey, publicLicenseKey) and delegates to the v2 provider.
 */
import type { CopilotKitProps } from "./types";
import CopilotKitProvider from "../../v2/providers/CopilotKitProvider.vue";

// Vue casts an absent boolean prop to `false`, and `v-bind` would forward
// that, so the on-by-default WebMCP setting needs its default here too.
const props = withDefaults(defineProps<CopilotKitProps>(), {
  defaultWebMCPTools: true,
});
</script>

<template>
  <CopilotKitProvider v-bind="props">
    <slot />
  </CopilotKitProvider>
</template>
