import { useCallback, useEffect, useRef, useState } from "react";
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
  agentId: string;
  baseThreadId: string;
  isAuthoritative: boolean;
}): {
  inspectorThreadId: string | null;
  endInspectorOverride: () => void;
} {
  const [override, setOverride] = useState<InspectorOverride | null>(null);
  const latestRef = useRef({
    agentId: args.agentId,
    baseThreadId: args.baseThreadId,
    isAuthoritative: args.isAuthoritative,
    override,
  });
  latestRef.current = {
    agentId: args.agentId,
    baseThreadId: args.baseThreadId,
    isAuthoritative: args.isAuthoritative,
    override,
  };

  const endInspectorOverride = useCallback(() => {
    setOverride(null);
  }, []);

  useEffect(() => {
    if (!isInspectorThreadBridgeEnabled()) return;

    const offView = onInspectorViewThread((payload) => {
      const current = latestRef.current;
      if (payload.agentId !== current.agentId) return;

      const next: InspectorOverride = current.override
        ? { ...current.override, threadId: payload.threadId }
        : {
            threadId: payload.threadId,
            previousThreadId: current.baseThreadId,
          };
      setOverride(next);
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
      const current = latestRef.current;
      if (payload.agentId !== current.agentId) return;
      if (!current.override) return;
      const restoredId = current.override.previousThreadId;
      setOverride(null);
      emitInspectorActiveThread({
        threadId: restoredId,
        agentId: current.agentId,
        source: "app",
      });
    });

    const offResult = onInspectorViewThreadResult((payload) => {
      const current = latestRef.current;
      if (payload.ok) return;
      if (payload.reason !== "connect-failed") return;
      if (payload.agentId !== current.agentId) return;
      if (current.override?.threadId !== payload.threadId) return;
      const restoredId = current.override.previousThreadId;
      setOverride(null);
      emitInspectorActiveThread({
        threadId: restoredId,
        agentId: current.agentId,
        source: "app",
      });
    });

    return () => {
      offView();
      offStop();
      offResult();
    };
  }, []);

  useEffect(() => {
    if (!override) return;
    if (!args.isAuthoritative) return;
    if (args.baseThreadId === override.previousThreadId) return;
    if (args.baseThreadId === override.threadId) return;
    setOverride(null);
    emitInspectorActiveThread({
      threadId: args.baseThreadId,
      agentId: args.agentId,
      source: "app",
    });
  }, [args.agentId, args.baseThreadId, args.isAuthoritative, override]);

  return {
    inspectorThreadId: override?.threadId ?? null,
    endInspectorOverride,
  };
}
