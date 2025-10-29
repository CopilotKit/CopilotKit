import React, { createContext, useContext, useCallback, useState, useRef, ReactNode } from "react";
import { CoAgentStateRender } from "../types/coagent-action";

export interface CoAgentStateRendersContextValue {
  coAgentStateRenders: Record<string, CoAgentStateRender<any>>;
  setCoAgentStateRender: (id: string, stateRender: CoAgentStateRender<any>) => void;
  removeCoAgentStateRender: (id: string) => void;
  renderMessageBindings: Record<string, Record<string, string>>; // runId -> stateRenderId -> messageId
  claimRenderForMessage: (runId: string, stateRenderId: string, messageId: string) => boolean;
  syncBindingsToState: () => void;
  migrateRunId: (oldRunId: string, newRunId: string) => void;
  clearBindingsForRun: (runId: string) => void;
}

const CoAgentStateRendersContext = createContext<CoAgentStateRendersContextValue | undefined>(
  undefined,
);

export function CoAgentStateRendersProvider({ children }: { children: ReactNode }) {
  const [coAgentStateRenders, setCoAgentStateRenders] = useState<
    Record<string, CoAgentStateRender<any>>
  >({});

  const setCoAgentStateRender = useCallback((id: string, stateRender: CoAgentStateRender<any>) => {
    setCoAgentStateRenders((prevPoints) => ({
      ...prevPoints,
      [id]: stateRender,
    }));
  }, []);

  const removeCoAgentStateRender = useCallback((id: string) => {
    setCoAgentStateRenders((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  }, []);

  const [renderMessageBindings, setRenderMessageBindings] = useState<
    Record<string, Record<string, string>>
  >({});
  const claimsRef = useRef<Record<string, Record<string, string>>>({});

  const claimRenderForMessage = useCallback(
    (runId: string, stateRenderId: string, messageId: string): boolean => {
      // Synchronous check via ref
      const existing = claimsRef.current[runId]?.[stateRenderId];
      if (existing) {
        return existing === messageId;
      }

      // First claimer - store in ref immediately (NO state update here)
      if (!claimsRef.current[runId]) claimsRef.current[runId] = {};
      claimsRef.current[runId][stateRenderId] = messageId;

      return true;
    },
    [],
  );

  const syncBindingsToState = useCallback(() => {
    setRenderMessageBindings({ ...claimsRef.current });
  }, []);

  const migrateRunId = useCallback((oldRunId: string, newRunId: string) => {
    // Migrate in ref (synchronous)
    if (claimsRef.current[oldRunId]) {
      claimsRef.current[newRunId] = claimsRef.current[oldRunId];
      delete claimsRef.current[oldRunId];
    }

    // Migrate in state
    setRenderMessageBindings((prev) => {
      if (!prev[oldRunId]) return prev;
      const { [oldRunId]: claims, ...rest } = prev;
      return { ...rest, [newRunId]: claims };
    });
  }, []);

  const clearBindingsForRun = useCallback((runId: string) => {
    // Clear both ref and state
    delete claimsRef.current[runId];
    setRenderMessageBindings((prev) => {
      const { [runId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return (
    <CoAgentStateRendersContext.Provider
      value={{
        coAgentStateRenders,
        setCoAgentStateRender,
        removeCoAgentStateRender,
        renderMessageBindings,
        claimRenderForMessage,
        syncBindingsToState,
        migrateRunId,
        clearBindingsForRun,
      }}
    >
      {children}
    </CoAgentStateRendersContext.Provider>
  );
}

export function useCoAgentStateRenders() {
  const context = useContext(CoAgentStateRendersContext);
  if (!context) {
    throw new Error("useCoAgentStateRenders must be used within CoAgentStateRendersProvider");
  }
  return context;
}

export { CoAgentStateRendersContext };
