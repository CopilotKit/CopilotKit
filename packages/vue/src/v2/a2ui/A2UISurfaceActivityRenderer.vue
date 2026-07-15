<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, ref, watch } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { A2UITheme } from "./types";
import type { A2UIOperation } from "./operations";
import { useCopilotKit } from "../providers";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { vueBasicCatalog, A2uiSurface, ThemeProvider } from "./vue-renderer";
import type { VueComponentImplementation } from "./vue-renderer";
import {
  runA2UIAction,
  surfaceHasRenderableContent,
} from "./A2UIMessageRenderer";
import type {
  A2UIActionInterceptor,
  A2UIClientEventMessage,
} from "./A2UIMessageRenderer";

const DEFAULT_SURFACE_ID = "default";

const props = defineProps<{
  activityType: string;
  content: { operations: A2UIOperation[] };
  message: ActivityMessage;
  agent?: object;
  theme?: A2UITheme;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catalog?: any;
  surfaceId?: string;
  onAction?: A2UIActionInterceptor;
  onReady?: () => void;
}>();

const { copilotkit } = useCopilotKit();

const processorRef =
  shallowRef<MessageProcessor<VueComponentImplementation> | null>(null);
const version = ref(0);
const error = ref<string | null>(null);
let lastOpsHash = "";

function getOrCreateProcessor(): MessageProcessor<VueComponentImplementation> {
  if (!processorRef.value) {
    const catalog = props.catalog ?? vueBasicCatalog;
    processorRef.value = new MessageProcessor<VueComponentImplementation>(
      [catalog],
      (action: unknown) => {
        void handleAction(action as A2UIClientEventMessage);
      },
    );
  }
  return processorRef.value;
}

async function handleAction(message: A2UIClientEventMessage) {
  await runA2UIAction({
    message,
    agent: props.agent,
    copilotkit: copilotkit.value,
    onAction: props.onAction,
  });
}

function processOperations(operations: A2UIOperation[]) {
  if (!operations?.length) return;

  const hash = JSON.stringify(operations);
  if (hash === lastOpsHash) return;
  lastOpsHash = hash;

  const processor = getOrCreateProcessor();
  const surfaceId = props.surfaceId ?? DEFAULT_SURFACE_ID;

  try {
    const existing = processor.model.getSurface(surfaceId);
    const filtered = existing
      ? operations.filter((op) => !("createSurface" in op && op.createSurface))
      : operations;
    processor.processMessages(filtered as never);
    error.value = null;

    if (props.onReady && surfaceHasRenderableContent(operations)) {
      props.onReady();
    }
  } catch (err) {
    console.warn("[A2UI Vue] processMessages error:", err);
    error.value = err instanceof Error ? err.message : String(err);
  }
  version.value++;
}

watch(
  () => [props.content.operations, props.surfaceId],
  () => {
    processOperations(props.content.operations);
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  processorRef.value = null;
  lastOpsHash = "";
});

const surfaceEntry = computed(() => {
  void version.value;
  if (!processorRef.value) return null;

  const surfaceId = props.surfaceId ?? DEFAULT_SURFACE_ID;
  const surface = processorRef.value.model.getSurface(surfaceId);
  if (!surface) return null;

  return { surfaceId, surface };
});
</script>

<template>
  <div
    v-if="content.operations?.length"
    data-copilotkit
    :data-activity-type="activityType"
    :data-message-id="message.id"
  >
    <div
      v-if="error"
      class="cpk:rounded-lg cpk:border cpk:border-red-200 cpk:bg-red-50 cpk:p-3 cpk:text-sm cpk:text-red-700"
    >
      A2UI render error: {{ error }}
    </div>
    <div
      v-else-if="surfaceEntry"
      class="cpk:flex cpk:w-full cpk:flex-none cpk:flex-col cpk:gap-4"
      :data-surface-id="surfaceEntry.surfaceId"
      data-testid="a2ui-activity-renderer"
    >
      <ThemeProvider :theme="theme">
        <div class="a2ui-surface cpk:flex cpk:flex-1">
          <A2uiSurface :surface="surfaceEntry.surface" />
        </div>
      </ThemeProvider>
    </div>
  </div>
</template>
