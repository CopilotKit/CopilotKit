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

export interface CoAgentStateRendersContextValue {
  coAgentStateRenders: Record<string, CoAgentStateRender<any>>;
  setCoAgentStateRender: (id: string, stateRender: CoAgentStateRender<any>) => void;
  removeCoAgentStateRender: (id: string) => void;
  claimsRef: RefObject<Record<string, Record<string, any>>>;
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

  const claimsRef = useRef<Record<string, Record<string, string>>>({});

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
    throw new Error("useCoAgentStateRenders must be used within CoAgentStateRendersProvider");
  }
  return context;
}

export { CoAgentStateRendersContext };
