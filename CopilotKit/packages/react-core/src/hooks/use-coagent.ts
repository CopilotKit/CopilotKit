import { useEffect } from "react";
import { CopilotContextParams, useCopilotContext } from "../context";
import { CoagentState } from "../types/coagent-state";
import { useCopilotChat } from "./use-copilot-chat";
import { AgentStateMessage, Message, Role, TextMessage } from "@copilotkit/runtime-client-gql";

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
  run: (hint?: HintFunction) => Promise<void>;
}

export interface HintFunctionParams {
  previousState: any;
  currentState: any;
}

export type HintFunction = (params: HintFunctionParams) => Message | undefined;

export function useCoAgent<T = any>(options: UseCoagentOptions<T>): UseCoagentReturnType<T> {
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

  const context = useCopilotContext();
  const { coagentStates, setCoagentStates } = context;
  const { appendMessage } = useCopilotChat();

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
    start: () => {
      startAgent(name, context);
    },
    stop: () => {
      stopAgent(name, context);
    },
    run: (hint?: HintFunction) => {
      return runAgent(name, context, appendMessage, hint);
    },
  };
}

function startAgent(name: string, context: CopilotContextParams) {
  const { setAgentSession } = context;
  setAgentSession({
    agentName: name,
  });
}

function stopAgent(name: string, context: CopilotContextParams) {
  const { agentSession, setAgentSession } = context;
  if (agentSession && agentSession.agentName === name) {
    setAgentSession(null);
  } else {
    console.warn(`No agent session found for ${name}`);
  }
}

async function runAgent(
  name: string,
  context: CopilotContextParams,
  appendMessage: (message: Message) => Promise<void>,
  hint?: HintFunction,
) {
  const { agentSession, setAgentSession } = context;
  if (!agentSession || agentSession.agentName !== name) {
    setAgentSession({
      agentName: name,
    });
  }

  let previousState: any = null;
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const message = context.messages[i];
    if (message instanceof AgentStateMessage && message.agentName === name) {
      previousState = message.state;
    }
  }

  let state = context.coagentStates?.[name]?.state || {};

  if (hint) {
    const hintMessage = hint({ previousState, currentState: state });
    if (hintMessage) {
      await appendMessage(hintMessage);
    }
  }
}
