import { useCopilotContext } from "../context";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";

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
  const { langGraphInterruptAction, setLangGraphInterruptAction, agentSession, threadId } =
    useCopilotContext();

  const [currentInterruptEvent, setCurrentInterruptEvent] = useState<{
    threadId: string;
    value: any;
  }>();

  useEffect(() => {
    if (!agent) return;
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "on_interrupt") {
          setCurrentInterruptEvent({
            threadId,
            value: event.value,
          });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
  }, [agent]);

  const handleResolve = useCallback(
    (response?: string) => {
      agent?.runAgent({
        forwardedProps: {
          command: {
            resume: response,
          },
        },
      });
    },
    [agent],
  );

  const responseRef = React.useRef<string>(undefined!);
  const resolveInterrupt = useCallback(
    (response: string) => {
      responseRef.current = response;
      // Use setTimeout to defer the state update to next tick
      setTimeout(() => {
        setLangGraphInterruptAction(threadId, { event: { response } });
      }, 0);
      handleResolve(response);
    },
    [setLangGraphInterruptAction, threadId, handleResolve],
  );

  return useMemo(() => {
    if (!langGraphInterruptAction || !currentInterruptEvent) return null;
    const { render, handler, enabled } = langGraphInterruptAction;

    const conditionsMet =
      !agentSession || !enabled
        ? true
        : enabled({ eventValue: currentInterruptEvent.value, agentMetadata: agentSession });

    if (!conditionsMet) {
      return null;
    }

    let result = null;
    if (handler) {
      result = handler({
        event: currentInterruptEvent.value,
        resolve: resolveInterrupt,
      });
    }

    if (!render || langGraphInterruptAction.event?.response) return null;

    return React.createElement(InterruptRenderer, {
      event: currentInterruptEvent.value,
      result,
      render,
      resolve: resolveInterrupt,
    });
  }, [langGraphInterruptAction, currentInterruptEvent]);
}
