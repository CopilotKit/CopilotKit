import { AgentStateMessage } from "@copilotkit/runtime-client-gql";
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

  const { visibleMessages, setMessages } = useCopilotChat();

  const setSpecificAgentState: SetAgentStateAction<T> = (newState) => {
    setAgentStates((prevAgentStates) => {
      const currentState = prevAgentStates[agentName];
      if (!currentState) {
        throw new Error(`Agent state ${agentName} not found`);
      }

      const updatedState =
        typeof newState === "function" ? (newState as Function)(currentState) : newState;

      const lastAgentStateMessage = [...visibleMessages]
        .reverse()
        .find((message): message is AgentStateMessage => message instanceof AgentStateMessage)!;

      const agentStateMessage = new AgentStateMessage({
        agentName,
        nodeName: lastAgentStateMessage.nodeName,
        state: updatedState,
        running: lastAgentStateMessage.running,
        threadId: lastAgentStateMessage.threadId,
        role: lastAgentStateMessage.role,
      });

      setMessages([...visibleMessages, agentStateMessage]);

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
