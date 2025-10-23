import { useCallback, useEffect, useRef } from "react";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { parseJson } from "@copilotkit/shared";
import { useAgent } from "@copilotkitnext/react";

export function useAgentSubscribers(agent?: ReturnType<typeof useAgent>["agent"]) {
  const predictStateToolsRef = useRef<
    {
      tool: string;
      state_key: string;
      tool_argument: string;
    }[]
  >([]);

  const getSubscriber = useCallback(
    (agent: AbstractAgent): AgentSubscriber => ({
      onCustomEvent: ({ event }) => {
        if (event.name === "PredictState") {
          predictStateToolsRef.current = event.value;
        }
      },
      onToolCallArgsEvent: ({ partialToolCallArgs, toolCallName }) => {
        predictStateToolsRef.current.forEach((t) => {
          if (t?.tool !== toolCallName) return;

          const emittedState =
            typeof partialToolCallArgs === "string"
              ? parseJson(partialToolCallArgs as unknown as string, partialToolCallArgs)
              : partialToolCallArgs;

          agent.setState({
            [t.state_key]: emittedState[t.state_key],
          });
        });
      },
    }),
    [],
  );

  useEffect(() => {
    if (!agent) return;

    const subscriber = getSubscriber(agent);
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
  }, [Boolean(agent)]);
}
