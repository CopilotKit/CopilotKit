import { useEffect, useRef } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "@copilotkitnext/react";

export function useAgentNodeName(agentName?: string) {
  const { agent } = useAgent({ agentId: agentName });
  const nodeNameRef = useRef<string>("start");

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        nodeNameRef.current = event.stepName;
      },
      onRunStartedEvent: () => {
        nodeNameRef.current = "start";
      },
      onRunFinishedEvent: () => {
        nodeNameRef.current = "end";
      },
    };

    const subscription = agent.subscribe(subscriber);
    return () => {
      subscription.unsubscribe();
    };
  }, [agent]);

  return nodeNameRef.current;
}
