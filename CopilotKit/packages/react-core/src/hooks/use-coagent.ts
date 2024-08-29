import { useEffect } from "react";
import { useCopilotContext } from "../context";
import { CoagentState } from "../types/coagent-state";

interface WithInternalStateManagementAndInitial<T> {
  name: string;
  initialState: T;
}

interface WithInternalStateManagement {
  name: string;
  initialState?: any; // Optional initialState with default type any
}

interface WithExternalStateManagement<T> {
  name: string;
  state: T;
  setState: (newState: T | ((prevState: T | undefined) => T)) => void;
}

type UseCoagentOptions<T> =
  | WithInternalStateManagementAndInitial<T>
  | WithInternalStateManagement
  | WithExternalStateManagement<T>;

export interface UseCoagentReturnType<T> {
  name: string;
  nodeName?: string;
  threadId?: string;
  running: boolean;
  state: T;
  setState: (newState: T | ((prevState: T | undefined) => T)) => void;
  start: () => void;
  stop: () => void;
}

export function useCoagent<T = any>(options: UseCoagentOptions<T>): UseCoagentReturnType<T> {
  const isExternalStateManagement = (
    options: UseCoagentOptions<T>,
  ): options is WithExternalStateManagement<T> => {
    return "state" in options && "setState" in options;
  };

  const { name } = options;

  const isInternalStateManagementWithInitial = (
    options: UseCoagentOptions<T>,
  ): options is WithInternalStateManagementAndInitial<T> => {
    return "initialState" in options;
  };

  const { coagentStates, setCoagentStates } = useCopilotContext();

  const getCoagentState = (coagentStates: Record<string, CoagentState>, name: string) => {
    if (coagentStates[name]) {
      return coagentStates[name];
    } else {
      return {
        name,
        state: isInternalStateManagementWithInitial(options) ? options.initialState : {},
        running: false,
        active: false,
        threadId: undefined,
        nodeName: undefined,
        runId: undefined,
      };
    }
  };

  // if we manage state internally, we need to provide a function to set the state
  const setState = (newState: T | ((prevState: T | undefined) => T)) => {
    setCoagentStates((prevAgentStates) => {
      let coagentState: CoagentState = getCoagentState(prevAgentStates, name);

      const updatedState =
        typeof newState === "function" ? (newState as Function)(coagentState.state) : newState;

      return {
        ...prevAgentStates,
        [name]: {
          ...coagentState,
          state: updatedState,
        },
      };
    });
  };

  const coagentState = getCoagentState(coagentStates, name);

  const state = isExternalStateManagement(options) ? options.state : coagentState.state;

  // Sync internal state with external state if state management is external
  useEffect(() => {
    if (isExternalStateManagement(options)) {
      setState(options.state);
    } else if (coagentStates[name] === undefined) {
      setState(options.initialState === undefined ? {} : options.initialState);
    }
  }, [isExternalStateManagement(options) ? JSON.stringify(options.state) : undefined]);

  // Return the state and setState function
  return {
    name,
    nodeName: coagentState.nodeName,
    state,
    setState,
    running: coagentState.running,
    start: () => {},
    stop: () => {},
  };
}

// <CopilotKit agent="lockedInAgentName" />
