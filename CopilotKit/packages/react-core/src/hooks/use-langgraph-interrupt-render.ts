import { useCopilotContext } from "../context";
import React, { useCallback } from "react";
import { executeConditions } from "@copilotkit/shared";

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

export function useLangGraphInterruptRender(): string | React.ReactElement | null {
  const { langGraphInterruptAction, setLangGraphInterruptAction, agentSession } =
    useCopilotContext();

  const responseRef = React.useRef<string>();
  const resolveInterrupt = useCallback(
    (response: string) => {
      responseRef.current = response;
      // Use setTimeout to defer the state update to next tick
      setTimeout(() => {
        setLangGraphInterruptAction({ event: { response } });
      }, 0);
    },
    [setLangGraphInterruptAction],
  );

  if (
    !langGraphInterruptAction ||
    !langGraphInterruptAction.event ||
    !langGraphInterruptAction.render
  )
    return null;

  const { render, handler, event, enabled } = langGraphInterruptAction;

  const conditionsMet =
    !agentSession || !enabled
      ? true
      : enabled({ eventValue: event.value, agentMetadata: agentSession });
  if (!conditionsMet) {
    return null;
  }

  let result = null;
  if (handler) {
    result = handler({
      event,
      resolve: resolveInterrupt,
    });
  }

  return React.createElement(InterruptRenderer, {
    event,
    result,
    render,
    resolve: resolveInterrupt,
  });
}
