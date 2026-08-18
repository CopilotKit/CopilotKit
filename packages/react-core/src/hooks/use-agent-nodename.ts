import { useEffect, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "../v2";

/**
 * Tracks the node the agent is currently executing.
 *
 * Backed by state rather than a ref: mutating a ref schedules no render, so
 * consumers such as `useCoAgent().nodeName` kept reporting whichever node was
 * current at their last render and never updated on their own.
 */
export function useAgentNodeName(agentName?: string) {
  const { agent } = useAgent({ agentId: agentName });
  const [nodeName, setNodeName] = useState<string>("start");

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        setNodeName(event.stepName);
      },
      onRunStartedEvent: () => {
        setNodeName("start");
      },
      onRunFinishedEvent: () => {
        setNodeName("end");
      },
      onRunErrorEvent: () => {
        setNodeName("end");
      },
    };

    const subscription = agent.subscribe(subscriber);
    return () => {
      subscription.unsubscribe();
    };
  }, [agent]);

  return nodeName;
}
