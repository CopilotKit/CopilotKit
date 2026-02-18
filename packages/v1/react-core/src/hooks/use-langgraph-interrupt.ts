import React, { useEffect, useRef } from "react";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useInterrupt, type UseInterruptConfig } from "@copilotkitnext/react";

export function useLangGraphInterrupt<TEventValue = any>(
  action: Omit<LangGraphInterruptRender<TEventValue>, "id">,
  dependencies?: any[],
) {
  const actionRef = useRef(action);
  useEffect(() => {
    actionRef.current = action;
  }, [action, ...(dependencies ?? [])]);

  useInterrupt<TEventValue>({
    render: ({ event, result, resolve }) => {
      const render = actionRef.current.render;
      if (!render) return React.createElement(React.Fragment);
      const rendered = render({
        event: event as any,
        result,
        resolve: (r) => resolve(r),
      });
      if (typeof rendered === "string") {
        return React.createElement(React.Fragment, null, rendered);
      }
      return rendered;
    },
    handler: actionRef.current.handler
      ? ({ event, resolve }) => {
          return actionRef.current.handler?.({
            event: event as any,
            resolve: (r) => resolve(r),
          });
        }
      : undefined,
    enabled: actionRef.current.enabled
      ? (event) => {
          return actionRef.current.enabled!({
            eventValue: event.value,
            agentMetadata: {} as any,
          });
        }
      : undefined,
  });
}
