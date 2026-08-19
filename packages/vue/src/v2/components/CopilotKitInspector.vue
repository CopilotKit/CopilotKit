<script setup lang="ts">
defineOptions({
  inheritAttrs: false,
});

import { onMounted, onUnmounted, shallowRef, useAttrs, watch } from "vue";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { WebInspectorElement } from "@copilotkit/web-inspector";

const props = defineProps<{
  core?: CopilotKitCoreVue | null;
}>();

const attrs = useAttrs();
const mountElement = shallowRef<HTMLSpanElement | null>(null);

let isMounted = true;
let inspector: WebInspectorElement | null = null;

function applyAttrs(element: WebInspectorElement): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (typeof value === "object" || typeof value === "function") {
      Reflect.set(element, name, value);
    } else {
      element.setAttribute(name, value === true ? "" : String(value));
    }
  }
}

onMounted(() => {
  void import("@copilotkit/web-inspector")
    .then((mod) => {
      if (!isMounted || !mountElement.value) return;

      mod.defineWebInspector?.();
      inspector = mountElement.value.ownerDocument.createElement(
        mod.WEB_INSPECTOR_TAG,
      ) as WebInspectorElement;
      mod.configureWebInspectorElement(inspector, props.core ?? null);
      applyAttrs(inspector);
      mountElement.value.appendChild(inspector);
    })
    .catch((error: unknown) => {
      console.error("Failed to load CopilotKit inspector:", error);
    });
});

onUnmounted(() => {
  isMounted = false;
  inspector?.remove();
  inspector = null;
});

watch(
  () => props.core,
  (core) => {
    if (inspector) inspector.core = core ?? null;
  },
);
</script>

<template>
  <span ref="mountElement" style="display: contents" />
</template>
