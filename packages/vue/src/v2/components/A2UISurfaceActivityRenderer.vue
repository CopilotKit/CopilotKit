<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { ActivityMessage } from "@ag-ui/core";
import type { A2UITheme } from "../types";
import type { A2UIOperation } from "./a2ui";
import { useCopilotKit } from "../providers";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import type { SurfaceModel } from "@a2ui/web_core/v0_9";
import { A2UIOperationApplier } from "@copilotkit/a2ui-renderer/engine";
import { A2UISurfaceDiagnostics } from "@copilotkit/a2ui-renderer/engine-core";
import { ɵrunA2UIAction, ɵtoA2UIClientEvent } from "@copilotkit/core";
import type {
  ɵA2UIActionAgent,
  ɵA2UIActionInterceptor,
} from "@copilotkit/core";
import { vueBasicCatalog, A2uiSurface } from "./a2ui/index";
import type { VueComponentImplementation } from "./a2ui/index";

const props = defineProps<{
  activityType: string;
  content: { operations: readonly A2UIOperation[] };
  message: ActivityMessage;
  agent?: ɵA2UIActionAgent;
  theme?: A2UITheme;
  catalog?: any;
  /** Intercepts a user action before it reaches the agent. */
  onAction?: ɵA2UIActionInterceptor;
}>();

const emit = defineEmits<{
  /** After each batch of operations was applied. */
  rendered: [];
}>();

const { copilotkit } = useCopilotKit();

type Surface = SurfaceModel<VueComponentImplementation>;

// One processor for all surfaces of the activity; the core-shared applier
// validates the operations and applies only what is new in each snapshot.
// shallowRef avoids Vue's deep UnwrapRef, which strips private class members.
let processor: MessageProcessor<VueComponentImplementation> | null = null;
let applier: A2UIOperationApplier<VueComponentImplementation> | null = null;
const surfaces = shallowRef<readonly Surface[]>([]);
const error = shallowRef<string | null>(null);
const diagnostics =
  process.env.NODE_ENV !== "production"
    ? new A2UISurfaceDiagnostics({ warn: (message) => console.warn(message) })
    : null;

function getApplier() {
  if (!processor || !applier) {
    const catalog = props.catalog ?? vueBasicCatalog;
    const created = new MessageProcessor<VueComponentImplementation>(
      [catalog],
      (action) =>
        ɵrunA2UIAction({
          message: ɵtoA2UIClientEvent(action),
          agent: props.agent,
          core: copilotkit.value,
          onAction: props.onAction,
        }),
    );
    processor = created;
    applier = new A2UIOperationApplier(created, catalog.id);
  }
  return applier;
}

function processOperations(operations: readonly A2UIOperation[]) {
  const current = getApplier();
  try {
    surfaces.value = current.apply(operations);
    error.value = null;
  } catch (err) {
    console.warn("[A2UI Vue] processMessages error:", err);
    error.value = err instanceof Error ? err.message : String(err);
    surfaces.value = [];
    return;
  }
  if (processor) diagnostics?.check(operations, processor.model);
  emit("rendered");
}

// A new catalog needs a new processor, rebuilt from the current operations.
watch(
  () => props.catalog,
  () => {
    processor = null;
    applier = null;
    processOperations(props.content.operations ?? []);
  },
);

watch(
  () => props.content.operations,
  (operations) => processOperations(operations ?? []),
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  diagnostics?.dispose();
  processor = null;
  applier = null;
});

const hasOperations = computed(
  () => (props.content.operations ?? []).length > 0,
);
</script>

<template>
  <div
    v-if="hasOperations"
    data-copilotkit
    :data-activity-type="activityType"
    :data-message-id="message.id"
  >
    <div v-if="error" class="cpk-a2ui-message-error">
      A2UI render error: {{ error }}
    </div>
    <div
      v-else
      class="cpk-a2ui-message-surfaces"
      data-testid="a2ui-activity-renderer"
    >
      <div
        v-for="surface in surfaces"
        :key="surface.id"
        class="cpk-a2ui-message-surface-host"
        :data-surface-id="surface.id"
      >
        <div class="a2ui-surface cpk-a2ui-message-surface">
          <A2uiSurface :surface="surface" />
        </div>
      </div>
    </div>
  </div>
</template>
