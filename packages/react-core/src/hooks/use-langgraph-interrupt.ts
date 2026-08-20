/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-core — useLangGraphInterrupt:
 *   V2 import and usage:
 *     import { useInterrupt } from "@copilotkit/react-core/v2";
 *
 *     function ApprovalInterrupt() {
 *       useInterrupt({
 *         render: ({ resolve }) => (
 *           <button onClick={() => resolve({ approved: true })}>Approve</button>
 *         ),
 *       });
 *       return null;
 *     }
 *   V2 replacement source: packages/react-core/src/v2/hooks/use-interrupt.tsx
 *   V2 docs: https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt
 *   Migration note: Use the framework-neutral v2 interrupt API.
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

import React, { useCallback, useRef } from "react";
import { LangGraphInterruptRender } from "../types/interrupt-action";
import { useInterrupt, useCopilotChatConfiguration } from "../v2";
import type {
  InterruptEvent,
  InterruptRenderProps,
  InterruptHandlerProps,
} from "../v2";
import { MetaEventName } from "@copilotkit/runtime-client-gql";
import { parseJson } from "@copilotkit/shared";
import { useAgentNodeName } from "./use-agent-nodename";
import type { AgentSession } from "../context/copilot-context";

/**
 * Transforms a v2 InterruptEvent into the v1 LangGraphInterruptEvent shape
 * expected by existing useLangGraphInterrupt callbacks.
 */
function toV1Event<TEventValue>(event: InterruptEvent<TEventValue>) {
  const value =
    typeof event.value === "string"
      ? parseJson(event.value, event.value)
      : event.value;
  return {
    name: MetaEventName.LangGraphInterruptEvent,
    type: "MetaEvent" as const,
    value,
  };
}

/**
 * @deprecated The v1 SDK is deprecated. Use v2 instead. Use `useInterrupt` from `@copilotkit/react-core/v2` instead.
 *
 * ```tsx
 * import { useInterrupt } from "@copilotkit/react-core/v2";
 *
 * function ApprovalInterrupt() {
 *   useInterrupt({
 *     render: ({ resolve }) => (
 *       <button onClick={() => resolve({ approved: true })}>Approve</button>
 *     ),
 *   });
 *   return null;
 * }
 * ```
 * See https://docs.copilotkit.ai/reference/v2/hooks/useInterrupt
 */
export function useLangGraphInterrupt<TEventValue = any>(
  action: Omit<LangGraphInterruptRender<TEventValue>, "id">,
  _dependencies?: any[],
) {
  const actionRef = useRef(action);
  // Update ref synchronously during render so it's always current
  // when callbacks read from it (useEffect would be one tick late).
  actionRef.current = action;

  const existingConfig = useCopilotChatConfiguration();
  const resolvedAgentId =
    action.agentId ?? existingConfig?.agentId ?? "default";
  const threadId = existingConfig?.threadId;
  const nodeName = useAgentNodeName(resolvedAgentId);

  // Keep agentMetadata in a ref so stable callbacks always see current values.
  const metadataRef = useRef<AgentSession>({
    agentName: resolvedAgentId,
    threadId,
    nodeName,
  });
  metadataRef.current = {
    agentName: resolvedAgentId,
    threadId,
    nodeName,
  };

  // Stable callback references that always read the latest action from the ref.
  // This prevents useInterrupt's internal useMemo/useEffect from seeing new
  // function identities on every render, which would cause an infinite loop.
  const render = useCallback(
    ({ event, result, resolve }: InterruptRenderProps<TEventValue>) => {
      const renderFn = actionRef.current.render;
      if (!renderFn) return React.createElement(React.Fragment);
      const rendered = renderFn({
        event: toV1Event(event) as any,
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
        event: toV1Event(event) as any,
        resolve: (r) => resolve(r),
      });
    },
    [],
  );

  const enabled = useCallback((event: InterruptEvent<TEventValue>) => {
    if (!actionRef.current.enabled) return true;
    return actionRef.current.enabled({
      eventValue: toV1Event(event).value,
      agentMetadata: metadataRef.current,
    });
  }, []);

  useInterrupt({
    render,
    handler,
    enabled,
    agentId: resolvedAgentId,
  });
}
