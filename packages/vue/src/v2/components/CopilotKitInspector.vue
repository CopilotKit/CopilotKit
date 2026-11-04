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
const boundListeners = new Map<
  string,
  { eventName: string; listener: (event: Event) => void }
>();

function isListener(name: string, value: unknown) {
  const isHandler = typeof value === "function" || Array.isArray(value);
  return /^on[A-Z]/.test(name) && isHandler;
}

/** `onCpkInspectorVisibilityChange` listens to `cpk-inspector-visibility-change`, as in Vue. */
function toEventName(name: string) {
  return name
    .slice(2)
    .replace(/\B([A-Z])/g, "-$1")
    .toLowerCase();
}

// Text attributes and listeners go to the Inspector element (the host is only
// a mount point), so `data-testid` or `@cpk-inspector-visibility-change`
// land where callers expect them.
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

function callListener(name: string, event: Event) {
  const handler = attrs[name];
  const handlers = Array.isArray(handler) ? handler : [handler];
  for (const candidate of handlers) {
    if (typeof candidate === "function") candidate(event);
  }
}

function syncListeners(element: Element) {
  const names = Object.keys(attrs).filter((name) =>
    isListener(name, attrs[name]),
  );
  for (const [name, bound] of boundListeners) {
    if (names.includes(name)) continue;
    element.removeEventListener(bound.eventName, bound.listener);
    boundListeners.delete(name);
  }
  for (const name of names) {
    if (boundListeners.has(name)) continue;
    const bound = {
      eventName: toEventName(name),
      listener: (event: Event) => callListener(name, event),
    };
    element.addEventListener(bound.eventName, bound.listener);
    boundListeners.set(name, bound);
  }
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
  syncListeners(element);
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
  boundListeners.clear();
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
