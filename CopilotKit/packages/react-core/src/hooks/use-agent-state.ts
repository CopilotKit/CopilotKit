import { useCopilotContext } from "../context";
import { useCopilotChat } from "./use-copilot-chat";

export type AgentStateInfo = {
  nodeName: string;
};

type SetAgentStateAction<T = any> = (newState: T | ((prevState: T | undefined) => T)) => void;

export type UseAgentStateReturnType<T = any> = [
  T | undefined,
  SetAgentStateAction<T>,
  AgentStateInfo | undefined,
];

export function useAgentState<T = any>(agentName: string): UseAgentStateReturnType<T> {
  const { agentStates, setAgentStates } = useCopilotContext();

  const { appendMessage } = useCopilotChat();

  const setSpecificAgentState: SetAgentStateAction<T> = (newState) => {
    setAgentStates((prevAgentStates) => {
      const currentState = prevAgentStates[agentName];
      if (!currentState) {
        throw new Error(`Agent state ${agentName} not found`);
      }

      const updatedState =
        typeof newState === "function" ? (newState as Function)(currentState) : newState;

      const agentStateMessage = { ...currentState, state: updatedState };

      appendMessage(agentStateMessage);

      return {
        ...prevAgentStates,
        [agentName]: agentStateMessage,
      };
    });
  };

  const currentState = agentStates[agentName];

  return [
    currentState?.state as T,
    setSpecificAgentState,
    currentState ? { nodeName: currentState.nodeName } : undefined,
  ];
}

export default useAgentState;
