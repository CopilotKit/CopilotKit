import React, { useCallback, useRef } from "react";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useInterrupt, type UseInterruptConfig } from "@copilotkitnext/react";
import type { InterruptEvent, InterruptRenderProps, InterruptHandlerProps } from "@copilotkitnext/react";

export function useLangGraphInterrupt<TEventValue = any>(
  action: Omit<LangGraphInterruptRender<TEventValue>, "id">,
  _dependencies?: any[],
) {
  const actionRef = useRef(action);
  // Update ref synchronously during render so it's always current
  // when callbacks read from it (useEffect would be one tick late).
  actionRef.current = action;

  // Stable callback references that always read the latest action from the ref.
  // This prevents useInterrupt's internal useMemo/useEffect from seeing new
  // function identities on every render, which would cause an infinite loop.
  const render = useCallback(
    ({ event, result, resolve }: InterruptRenderProps<TEventValue>) => {
      const renderFn = actionRef.current.render;
      if (!renderFn) return React.createElement(React.Fragment);
      const rendered = renderFn({
        event: event as any,
        result,
        resolve: (r) => resolve(r),
      });
      if (typeof rendered === "string") {
        return React.createElement(React.Fragment, null, rendered);
      }
      return rendered;
    },
    [],
  );

  // Handler always delegates to the ref — if no handler is set at call time,
  // the optional chaining returns undefined which useInterrupt treats as null.
  const handler = useCallback(
    ({ event, resolve }: InterruptHandlerProps<TEventValue>) => {
      return actionRef.current.handler?.({
        event: event as any,
        resolve: (r) => resolve(r),
      });
    },
    [],
  );

  const enabled = useCallback(
    (event: InterruptEvent<TEventValue>) => {
      if (!actionRef.current.enabled) return true;
      return actionRef.current.enabled({
        eventValue: event.value,
        agentMetadata: {} as any,
      });
    },
    [],
  );

  useInterrupt<TEventValue>({
    render,
    handler,
    enabled,
  });
}
