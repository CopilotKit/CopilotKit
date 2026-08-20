/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — CoAgentStateRendersContext:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CoAgentStateRendersContextValue:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — CoAgentStateRendersProvider:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * @copilotkit/react-core — useCoAgentStateRenders:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 * V1 source file: packages/react-core/src/context/coagent-state-renders-context.tsx
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useRef,
  ReactNode,
  RefObject,
} from "react";
import { CoAgentStateRender } from "../types/coagent-action";

interface StateRenderClaim {
  stateRenderId: string;
  stateSnapshot?: any;
  runId?: string;
  messageIndex?: number;
  locked?: boolean;
}

type ClaimsRef = Record<string, StateRenderClaim>;

export interface CoAgentStateRendersContextValue {
  coAgentStateRenders: Record<string, CoAgentStateRender<any>>;
  setCoAgentStateRender: (
    id: string,
    stateRender: CoAgentStateRender<any>,
  ) => void;
  removeCoAgentStateRender: (id: string) => void;
  claimsRef: RefObject<ClaimsRef>;
}

const CoAgentStateRendersContext = createContext<
  CoAgentStateRendersContextValue | undefined
>(undefined);

export function CoAgentStateRendersProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [coAgentStateRenders, setCoAgentStateRenders] = useState<
    Record<string, CoAgentStateRender<any>>
  >({});

  const setCoAgentStateRender = useCallback(
    (id: string, stateRender: CoAgentStateRender<any>) => {
      setCoAgentStateRenders((prevPoints) => ({
        ...prevPoints,
        [id]: stateRender,
      }));
    },
    [],
  );

  const removeCoAgentStateRender = useCallback((id: string) => {
    setCoAgentStateRenders((prevPoints) => {
      const newPoints = { ...prevPoints };
      delete newPoints[id];
      return newPoints;
    });
  }, []);

  const claimsRef = useRef<ClaimsRef>({});

  return (
    <CoAgentStateRendersContext.Provider
      value={{
        coAgentStateRenders,
        setCoAgentStateRender,
        removeCoAgentStateRender,
        claimsRef,
      }}
    >
      {children}
    </CoAgentStateRendersContext.Provider>
  );
}

export function useCoAgentStateRenders() {
  const context = useContext(CoAgentStateRendersContext);
  if (!context) {
    throw new Error(
      "useCoAgentStateRenders must be used within CoAgentStateRendersProvider",
    );
  }
  return context;
}

export { CoAgentStateRendersContext };
