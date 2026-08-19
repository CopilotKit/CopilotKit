import { useCallback, useEffect, useRef, useState } from "react";
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
  agentId: string;
  baseThreadId: string;
}): {
  inspectorThreadId: string | null;
  inspectorRequestId: string | null;
  failInspectorOverride: (requestId: string) => void;
} {
  const [override, setOverride] = useState<InspectorOverride | null>(null);
  const latestRef = useRef({ ...args, override });
  latestRef.current = { ...args, override };

  const restoreOverride = useCallback(
    (current: InspectorOverride, nextThreadId: string) => {
      setOverride(null);
      emitInspectorActiveThread({
        requestId: current.requestId,
        threadId: nextThreadId,
        agentId: current.agentId,
        source: "app",
      });
    },
    [],
  );

  const failInspectorOverride = useCallback(
    (requestId: string) => {
      const current = latestRef.current.override;
      if (!current || current.requestId !== requestId) return;
      emitInspectorViewThreadResult({
        requestId,
        threadId: current.threadId,
        agentId: current.agentId,
        ok: false,
        reason: "connect-failed",
      });
      restoreOverride(current, current.previousThreadId);
    },
    [restoreOverride],
  );

  useEffect(() => {
    if (!isInspectorThreadBridgeEnabled()) return;

    const offView = onInspectorViewThread((payload) => {
      const current = latestRef.current;
      if (payload.agentId !== current.agentId) return false;

      const next: InspectorOverride = current.override
        ? { ...current.override, ...payload }
        : {
            ...payload,
            previousThreadId: current.baseThreadId,
          };
      setOverride(next);
      emitInspectorViewThreadResult({ ...payload, ok: true });
      emitInspectorActiveThread({ ...payload, source: "override" });
      return true;
    });

    const offStop = onInspectorStopViewing((payload) => {
      const current = latestRef.current.override;
      if (!current) return;
      if (payload.requestId !== current.requestId) return;
      if (payload.agentId !== current.agentId) return;
      restoreOverride(current, current.previousThreadId);
    });

    return () => {
      offView();
      offStop();
    };
  }, [restoreOverride]);

  useEffect(() => {
    if (!override) return;
    if (args.agentId !== override.agentId) {
      restoreOverride(override, override.previousThreadId);
      return;
    }
    if (args.baseThreadId === override.previousThreadId) return;
    if (args.baseThreadId === override.threadId) return;
    restoreOverride(override, args.baseThreadId);
  }, [args.agentId, args.baseThreadId, override, restoreOverride]);

  return {
    inspectorThreadId: override?.threadId ?? null,
    inspectorRequestId: override?.requestId ?? null,
    failInspectorOverride,
  };
}
