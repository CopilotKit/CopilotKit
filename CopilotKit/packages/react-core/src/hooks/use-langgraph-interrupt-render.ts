import { useCopilotContext } from "../context";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { LangGraphInterruptEvent, MetaEventName } from "@copilotkit/runtime-client-gql";
import { parseJson } from "@copilotkit/shared";

type InterruptProps = {
  event: any;
  result: any;
  render: (props: {
    event: any;
    result: any;
    resolve: (response: string) => void;
  }) => string | React.ReactElement;
  resolve: (response: string) => void;
};

const InterruptRenderer: React.FC<InterruptProps> = ({ event, result, render, resolve }) => {
  return render({ event, result, resolve });
};

export function useLangGraphInterruptRender(
  agent: AbstractAgent,
): string | React.ReactElement | null {
  const { interruptActions, setInterruptAction, agentSession, threadId } = useCopilotContext();

  const [currentInterruptEvent, setCurrentInterruptEvent] = useState<{
    threadId: string;
    event: LangGraphInterruptEvent;
  } | null>(null);

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          setCurrentInterruptEvent({
            threadId,
            event: {
              name: MetaEventName.LangGraphInterruptEvent,
              type: event.type,
              value: parseJson(event.value, event.value),
            },
          });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
  }, [agent, threadId]);

  const handleResolve = useCallback(
    (response?: string) => {
      agent?.runAgent({
        forwardedProps: {
          command: {
            resume: response,
          },
        },
      });
      setCurrentInterruptEvent(null);
    },
    [agent],
  );

  const resolveInterrupt = useCallback(
    (response: string) => {
      handleResolve(response);
    },
    [threadId, handleResolve],
  );

  return useMemo(() => {
    const currentAction = interruptActions[threadId];
    if (!currentAction || !currentInterruptEvent) return null;
    const { render, handler, enabled } = currentAction;

    const conditionsMet =
      !agentSession || !enabled
        ? true
        : enabled({ eventValue: currentInterruptEvent.event.value, agentMetadata: agentSession });

    if (!conditionsMet) {
      return null;
    }

    let result = null;
    if (handler) {
      result = handler({
        event: currentInterruptEvent.event,
        resolve: resolveInterrupt,
      });
    }

    if (!render || currentAction.event?.response) return null;

    return React.createElement(InterruptRenderer, {
      event: currentInterruptEvent.event,
      result,
      render,
      resolve: resolveInterrupt,
    });
  }, [interruptActions, currentInterruptEvent, agentSession, resolveInterrupt]);
}
