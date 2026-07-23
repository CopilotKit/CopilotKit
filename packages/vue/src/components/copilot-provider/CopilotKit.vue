<script setup lang="ts">
/**
 * V1 compatibility wrapper for CopilotKitProvider.
 *
 * Accepts the same props as CopilotKitProvider plus legacy v1 props
 * (publicApiKey, publicLicenseKey) and delegates to the v2 provider.
 */
import type { CopilotKitProps } from "./types";
import CopilotKitProvider from "../../v2/providers/CopilotKitProvider.vue";

const props = defineProps<CopilotKitProps>();
</script>

<template>
  <CopilotKitProvider v-bind="props">
    <slot />
  </CopilotKitProvider>
</template>
