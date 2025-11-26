import { useCopilotContext } from "../context";
import React, { useCallback, useEffect, useMemo } from "react";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { MetaEventName } from "@copilotkit/runtime-client-gql";
import { dataToUUID, parseJson } from "@copilotkit/shared";
import { useAgentNodeName } from "./use-agent-nodename";
import { useCopilotChatConfiguration } from "@copilotkitnext/react";

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
  const {
    interruptActions,
    agentSession,
    threadId,
    interruptEventQueue,
    addInterruptEvent,
    removeInterruptEvent,
  } = useCopilotContext();
  const existingConfig = useCopilotChatConfiguration();
  const resolvedAgentId = existingConfig?.agentId ?? 'default';
  const nodeName = useAgentNodeName(resolvedAgentId);

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          const eventData = {
            name: MetaEventName.LangGraphInterruptEvent,
            type: event.type,
            value: parseJson(event.value, event.value),
          };
          const eventId = dataToUUID(JSON.stringify(eventData), "interruptEvents");
          addInterruptEvent({
            eventId,
            threadId,
            event: eventData,
          });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, threadId]);

  const handleResolve = useCallback(
    (eventId: string, response?: string) => {
      agent?.runAgent({
        forwardedProps: {
          command: {
            resume: response,
          },
        },
      });
      removeInterruptEvent(threadId, eventId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent, threadId],
  );

  return useMemo(() => {
    // Get the queue for this thread and find the first unresponded event
    const eventQueue = interruptEventQueue[threadId] || [];
    const currentQueuedEvent = eventQueue.find((qe) => !qe.event.response);

    if (!currentQueuedEvent || !agentSession) return null;

    // Find the first matching action from all registered actions
    const allActions = Object.values(interruptActions);
    const matchingAction = allActions.find((action) => {
      if (!action.enabled) return true; // No filter = match all
      return action.enabled({
        eventValue: currentQueuedEvent.event.value,
        agentMetadata: {
          ...agentSession,
          nodeName,
        },
      });
    });

    if (!matchingAction) return null;

    const { render, handler } = matchingAction;

    const resolveInterrupt = (response: string) => {
      handleResolve(currentQueuedEvent.eventId, response);
    };

    let result = null;
    if (handler) {
      result = handler({
        event: currentQueuedEvent.event,
        resolve: resolveInterrupt,
      });
    }

    if (!render) return null;

    return React.createElement(InterruptRenderer, {
      event: currentQueuedEvent.event,
      result,
      render,
      resolve: resolveInterrupt,
    });
  }, [interruptActions, interruptEventQueue, threadId, agentSession, handleResolve]);
}
