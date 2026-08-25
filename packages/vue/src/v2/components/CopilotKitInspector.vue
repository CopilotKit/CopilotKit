<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

import { onMounted, onUnmounted, shallowRef, useAttrs, watch } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { VueInspectorOpenRequest } from "../providers/keys";

const props = defineProps<{
  core?: CopilotKitCoreVue | null;
  openRequest?: VueInspectorOpenRequest | null;
}>();

const attrs = useAttrs();
const inspectorTag = shallowRef<string | null>(null);

let isMounted = true;

onMounted(() => {
  void import("@copilotkit/web-inspector")
    .then((mod) => {
      mod.defineWebInspector?.();
      if (!isMounted) return;
      inspectorTag.value = mod.WEB_INSPECTOR_TAG;
    })
    .catch((error: unknown) => {
      console.error("Failed to load CopilotKit inspector:", error);
    });
});

onUnmounted(() => {
  isMounted = false;
});

watch(
  () => [inspectorTag.value, props.openRequest] as const,
  ([tag, request]) => {
    if (!tag || !request) {
      return;
    }
    const element = document.querySelector(tag) as {
      openInspector?: (
        source: string,
        options: VueInspectorOpenRequest,
      ) => void;
    } | null;
    element?.openInspector?.("message_toolbar", request);
  },
);
</script>

<template>
  <component
    :is="inspectorTag"
    v-if="inspectorTag"
    v-bind="attrs"
    :core.prop="props.core ?? null"
  />
</template>
