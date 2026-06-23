import { useEffect, useRef, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "../v2";

export function useAgentNodeName(agentName?: string) {
  const { agent } = useAgent({ agentId: agentName });

  // State for re-rendering component
  const [nodeName, setNodeName] = useState<string>("start");

  // Ref for storing latest value
  const nodeNameRef = useRef<string>("start");

  useEffect(() => {
    if (!agent) return;

    const updateNodeName = (name: string) => {
      nodeNameRef.current = name;
      setNodeName(name);
    };

    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        updateNodeName(event.stepName);
      },

      onRunStartedEvent: () => {
        updateNodeName("start");
      },

      onRunFinishedEvent: () => {
        updateNodeName("end");
      },

      onRunErrorEvent: () => {
        updateNodeName("end");
      },
    };

    const subscription = agent.subscribe(subscriber);

    return () => {
      subscription.unsubscribe();
    };
  }, [agent]);

  return nodeName;
}