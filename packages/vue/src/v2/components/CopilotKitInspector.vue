<script setup lang="ts">
import { version as sdkVersion } from "../../../package.json";
defineOptions({
  inheritAttrs: false,
});

import { onBeforeUnmount, onMounted, ref, useAttrs, watch } from "vue";
import { ɵmountInspector } from "@copilotkit/web-inspector/mount";
import type { ɵInspectorMount } from "@copilotkit/web-inspector/mount";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import type { VueInspectorOpenRequest } from "../providers/keys";

const props = defineProps<{
  core?: CopilotKitCoreVue | null;
  openRequest?: VueInspectorOpenRequest | null;
}>();

const emit = defineEmits<{
  "visibility-change": [visible: boolean];
}>();

const attrs = useAttrs();
const host = ref<HTMLSpanElement | null>(null);
let mount: ɵInspectorMount | null = null;
let appliedAttributes: Record<string, string> = {};

// Text attributes go to the Inspector element (the host is only a mount
// point), so markers such as `data-testid` land where callers look for them.
function toAttributes(source: Record<string, unknown>) {
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number") {
      attributes[name] = String(value);
    } else if (value === true) {
      attributes[name] = "";
    }
  }
  return attributes;
}

function syncAttributes() {
  const element = mount?.element;
  if (!element) return;
  const next = toAttributes(attrs);
  for (const name of Object.keys(appliedAttributes)) {
    if (!(name in next)) element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next)) {
    element.setAttribute(name, value);
  }
  appliedAttributes = next;
}

onMounted(() => {
  if (!host.value) return;
  mount = ɵmountInspector(host.value, props.core ?? null, {
    load: () => import("@copilotkit/web-inspector"),
    notificationContext: {
      development: process.env.NODE_ENV === "development",
      framework: "vue",
      sdkVersion,
    },
  });
  mount.onVisibility((visible) => emit("visibility-change", visible));
  mount.onElement(syncAttributes);
  if (props.openRequest) mount.open(props.openRequest);
});

onBeforeUnmount(() => {
  mount?.dispose();
  mount = null;
});

watch(
  () => props.core,
  (core) => mount?.setCore(core ?? null),
);

watch(
  () => props.openRequest,
  (request) => {
    if (request) mount?.open(request);
  },
);

watch(() => ({ ...attrs }), syncAttributes);
</script>

<template>
  <span ref="host" style="display: contents" />
</template>
