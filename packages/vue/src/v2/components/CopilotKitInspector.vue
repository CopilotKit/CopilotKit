<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

import { onMounted, onUnmounted, shallowRef, useAttrs, watch } from "vue";
import type { ObjectDirective } from "vue";
import type { WebInspectorElement } from "@copilotkit/web-inspector";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { VueInspectorOpenRequest } from "../providers/keys";

const props = defineProps<{
  core?: CopilotKitCoreVue | null;
  openRequest?: VueInspectorOpenRequest | null;
}>();

const attrs = useAttrs();
const inspectorTag = shallowRef<string | null>(null);
const inspector = shallowRef<WebInspectorElement | null>(null);

let isMounted = true;
let configureInspector:
  | ((
      element: WebInspectorElement,
      core: CopilotKitCoreVue | null,
    ) => WebInspectorElement)
  | null = null;

const vConfigureInspector: ObjectDirective<WebInspectorElement, undefined> = {
  created(element) {
    configureInspector?.(element, props.core ?? null);
    inspector.value = element;
    if (props.openRequest) {
      element.openInspector("message_toolbar", props.openRequest);
    }
  },
};

onMounted(() => {
  void import("@copilotkit/web-inspector")
    .then((mod) => {
      if (!isMounted) return;

      mod.defineWebInspector?.();
      configureInspector = mod.configureWebInspectorElement;
      inspectorTag.value = mod.WEB_INSPECTOR_TAG;
    })
    .catch((error: unknown) => {
      console.error("Failed to load CopilotKit inspector:", error);
    });
});

onUnmounted(() => {
  isMounted = false;
  inspector.value = null;
});

watch(
  () => props.core,
  (core) => {
    if (inspector.value) inspector.value.core = core ?? null;
  },
);

watch(
  () => props.openRequest,
  (request) => {
    if (request) inspector.value?.openInspector("message_toolbar", request);
  },
);
</script>

<template>
  <component
    :is="inspectorTag"
    v-if="inspectorTag"
    v-bind="attrs"
    v-configure-inspector
  />
</template>
