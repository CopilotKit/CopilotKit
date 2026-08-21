import { useEffect, useState } from "react";
import type { AgentSubscriber } from "@ag-ui/client";
import { useAgent } from "../v2";
import { INTERRUPT_EVENT_NAME } from "../v2/types/interrupt";

interface AgentNodeNameState {
  nodeName: string;
  lastActiveNodeName: string;
  hasLegacyInterrupt: boolean;
}

type AgentNodeNameEvent =
  | { type: "reset" }
  | { type: "runStarted" }
  | { type: "stepStarted"; nodeName: string }
  | { type: "legacyInterruptReceived" }
  | { type: "runFinished"; outcome: "success" | "interrupt" }
  | { type: "runError" };

type AgentNodeNameTransition = (
  state: AgentNodeNameState,
  event: AgentNodeNameEvent,
) => AgentNodeNameState;

const initialAgentNodeNameState: AgentNodeNameState = {
  nodeName: "start",
  lastActiveNodeName: "start",
  hasLegacyInterrupt: false,
};

const transitionAgentNodeName: AgentNodeNameTransition = (state, event) => {
  switch (event.type) {
    case "reset":
    case "runStarted":
      return initialAgentNodeNameState;
    case "stepStarted":
      return {
        ...state,
        nodeName: event.nodeName,
        lastActiveNodeName: event.nodeName,
      };
    case "legacyInterruptReceived":
      return { ...state, hasLegacyInterrupt: true };
    case "runFinished":
      if (event.outcome === "interrupt" || state.hasLegacyInterrupt) {
        return {
          ...state,
          nodeName: state.lastActiveNodeName,
          hasLegacyInterrupt: false,
        };
      }
      return { ...state, nodeName: "end", hasLegacyInterrupt: false };
    case "runError":
      return { ...state, nodeName: "end", hasLegacyInterrupt: false };
  }
};

/**
 * Tracks the node the agent is currently executing.
 *
 * Backed by state rather than a ref: mutating a ref schedules no render, so
 * consumers such as `useCoAgent().nodeName` kept reporting whichever node was
 * current at their last render and never updated on their own. Interrupt-aware
 * transitions keep the last active node available while an interrupt is pending.
 */
export function useAgentNodeName(agentName?: string) {
  const { agent } = useAgent({ agentId: agentName });
  const [nodeNameState, setNodeNameState] = useState(initialAgentNodeNameState);

  useEffect(() => {
    const transition = (event: AgentNodeNameEvent) => {
      setNodeNameState((state) => transitionAgentNodeName(state, event));
    };

    transition({ type: "reset" });
    if (!agent) return;

    const subscriber: AgentSubscriber = {
      onStepStartedEvent: ({ event }) => {
        transition({ type: "stepStarted", nodeName: event.stepName });
      },
      onRunStartedEvent: () => {
        transition({ type: "runStarted" });
      },
      onRunFinishedEvent: ({ outcome }) => {
        transition({ type: "runFinished", outcome });
      },
      onRunErrorEvent: () => {
        transition({ type: "runError" });
      },
      onCustomEvent: ({ event }) => {
        if (event.name === INTERRUPT_EVENT_NAME) {
          transition({ type: "legacyInterruptReceived" });
        }
      },
    };

    const subscription = agent.subscribe(subscriber);
    return () => {
      subscription.unsubscribe();
    };
  }, [agent, agentName]);

  return nodeNameState.nodeName;
}
