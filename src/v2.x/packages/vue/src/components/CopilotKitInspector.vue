<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

import { onMounted, onUnmounted, shallowRef, useAttrs } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";

const props = defineProps<{
  core?: CopilotKitCoreVue | null;
}>();

const attrs = useAttrs();
const inspectorTag = shallowRef<string | null>(null);

let isMounted = true;

onMounted(() => {
  void import("@copilotkitnext/web-inspector")
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
</script>

<template>
  <component
    :is="inspectorTag"
    v-if="inspectorTag"
    v-bind="attrs"
    :core.prop="props.core ?? null"
  />
</template>
