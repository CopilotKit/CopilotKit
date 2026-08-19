import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  emitInspectorActiveThread,
  emitInspectorViewThreadResult,
  isInspectorThreadBridgeEnabled,
  onInspectorStopViewing,
  onInspectorViewThread,
  onInspectorViewThreadResult,
} from "@copilotkit/core";

type InspectorOverride = {
  threadId: string;
  previousThreadId: string;
};

export function useInspectorThreadOverride(args: {
  agentId: Ref<string>;
  baseThreadId: Ref<string>;
  isAuthoritative: Ref<boolean>;
}): {
  inspectorThreadId: Ref<string | null>;
  endInspectorOverride: () => void;
} {
  const override = ref<InspectorOverride | null>(null);

  const endInspectorOverride = () => {
    override.value = null;
  };

  if (isInspectorThreadBridgeEnabled()) {
    const offView = onInspectorViewThread((payload) => {
      if (payload.agentId !== args.agentId.value) return;
      override.value = override.value
        ? { ...override.value, threadId: payload.threadId }
        : {
            threadId: payload.threadId,
            previousThreadId: args.baseThreadId.value,
          };
      emitInspectorViewThreadResult({
        threadId: payload.threadId,
        agentId: payload.agentId,
        ok: true,
      });
      emitInspectorActiveThread({
        threadId: payload.threadId,
        agentId: payload.agentId,
        source: "override",
      });
    });

    const offStop = onInspectorStopViewing((payload) => {
      if (payload.agentId !== args.agentId.value) return;
      if (!override.value) return;
      const restoredId = override.value.previousThreadId;
      override.value = null;
      emitInspectorActiveThread({
        threadId: restoredId,
        agentId: args.agentId.value,
        source: "app",
      });
    });

    const offResult = onInspectorViewThreadResult((payload) => {
      if (payload.ok) return;
      if (payload.reason !== "connect-failed") return;
      if (payload.agentId !== args.agentId.value) return;
      if (override.value?.threadId !== payload.threadId) return;
      const restoredId = override.value.previousThreadId;
      override.value = null;
      emitInspectorActiveThread({
        threadId: restoredId,
        agentId: args.agentId.value,
        source: "app",
      });
    });

    onBeforeUnmount(() => {
      offView();
      offStop();
      offResult();
    });
  }

  watch(
    () => [
      args.baseThreadId.value,
      args.isAuthoritative.value,
      override.value,
    ],
    () => {
      if (!override.value) return;
      if (!args.isAuthoritative.value) return;
      if (args.baseThreadId.value === override.value.previousThreadId) return;
      if (args.baseThreadId.value === override.value.threadId) return;
      override.value = null;
      emitInspectorActiveThread({
        threadId: args.baseThreadId.value,
        agentId: args.agentId.value,
        source: "app",
      });
    },
  );

  return {
    inspectorThreadId: computed(() => override.value?.threadId ?? null),
    endInspectorOverride,
  };
}
