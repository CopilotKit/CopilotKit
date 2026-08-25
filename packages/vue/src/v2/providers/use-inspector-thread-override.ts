import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { Ref } from "vue";
import {
  emitInspectorActiveThread,
  emitInspectorViewThreadResult,
  isInspectorThreadBridgeEnabled,
  onInspectorStopViewing,
  onInspectorViewThread,
} from "@copilotkit/core";

type InspectorOverride = {
  requestId: string;
  threadId: string;
  agentId: string;
  previousThreadId: string;
};

export function useInspectorThreadOverride(args: {
  agentId: Ref<string>;
  baseThreadId: Ref<string>;
}): {
  inspectorThreadId: Ref<string | null>;
  inspectorRequestId: Ref<string | null>;
  failInspectorOverride: (requestId: string) => void;
} {
  const override = ref<InspectorOverride | null>(null);

  const restoreOverride = (
    current: InspectorOverride,
    nextThreadId: string,
  ) => {
    override.value = null;
    emitInspectorActiveThread({
      requestId: current.requestId,
      threadId: nextThreadId,
      agentId: current.agentId,
      source: "app",
    });
  };

  const failInspectorOverride = (requestId: string) => {
    const current = override.value;
    if (!current || current.requestId !== requestId) return;
    emitInspectorViewThreadResult({
      requestId,
      threadId: current.threadId,
      agentId: current.agentId,
      ok: false,
      reason: "connect-failed",
    });
    restoreOverride(current, current.previousThreadId);
  };

  if (isInspectorThreadBridgeEnabled()) {
    const offView = onInspectorViewThread((payload) => {
      if (payload.agentId !== args.agentId.value) return false;
      override.value = override.value
        ? { ...override.value, ...payload }
        : {
            ...payload,
            previousThreadId: args.baseThreadId.value,
          };
      emitInspectorViewThreadResult({ ...payload, ok: true });
      emitInspectorActiveThread({ ...payload, source: "override" });
      return true;
    });

    const offStop = onInspectorStopViewing((payload) => {
      const current = override.value;
      if (!current) return;
      if (payload.requestId !== current.requestId) return;
      if (payload.agentId !== current.agentId) return;
      restoreOverride(current, current.previousThreadId);
    });

    onBeforeUnmount(() => {
      offView();
      offStop();
    });
  }

  watch([args.agentId, args.baseThreadId], ([agentId, baseThreadId]) => {
    const current = override.value;
    if (!current) return;
    if (agentId !== current.agentId) {
      restoreOverride(current, current.previousThreadId);
      return;
    }
    if (baseThreadId === current.previousThreadId) return;
    if (baseThreadId === current.threadId) return;
    restoreOverride(current, baseThreadId);
  });

  return {
    inspectorThreadId: computed(() => override.value?.threadId ?? null),
    inspectorRequestId: computed(() => override.value?.requestId ?? null),
    failInspectorOverride,
  };
}
