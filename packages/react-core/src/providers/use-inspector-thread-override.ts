import { useEffect, useState, useSyncExternalStore } from "react";
import { ɵInspectorThreadOverride } from "@copilotkit/core";

/**
 * Apply the Inspector's "view this thread" requests to a chat. Core's
 * `ɵInspectorThreadOverride` owns the state machine; this hook binds it to
 * the component's lifetime and React's render cycle.
 */
export function useInspectorThreadOverride(args: {
  agentId: string;
  baseThreadId: string;
}): {
  inspectorThreadId: string | null;
  inspectorRequestId: string | null;
  failInspectorOverride: (requestId: string) => void;
} {
  const [controller] = useState(() => new ɵInspectorThreadOverride(args));
  const override = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  const { agentId, baseThreadId } = args;
  useEffect(() => {
    controller.update({ agentId, baseThreadId });
  }, [controller, agentId, baseThreadId]);

  return {
    inspectorThreadId: override?.threadId ?? null,
    inspectorRequestId: override?.requestId ?? null,
    failInspectorOverride: controller.fail,
  };
}
