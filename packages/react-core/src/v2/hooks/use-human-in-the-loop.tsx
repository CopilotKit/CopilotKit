import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { ToolCallStatus } from "@copilotkit/core";
import { useCallback, useEffect, useRef } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

export function useHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const resolvePromiseRef = useRef<((result: unknown) => void) | null>(null);
  // Cleanup that detaches the pending abort listener; cleared whenever the
  // promise settles (via respond() or abort) so the listener can't fire twice
  // or leak after the interaction is done.
  const cleanupAbortRef = useRef<(() => void) | null>(null);

  const respond = useCallback(async (result: unknown) => {
    if (resolvePromiseRef.current) {
      cleanupAbortRef.current?.();
      cleanupAbortRef.current = null;
      resolvePromiseRef.current(result);
      resolvePromiseRef.current = null;
    }
  }, []);

  const handler = useCallback(
    async (_args: T, context?: { signal?: AbortSignal }) => {
      const signal = context?.signal;
      return new Promise((resolve, reject) => {
        // If the run was already aborted before the handler ran, reject
        // immediately so core records an explicit error tool result instead of
        // silently resolving to an empty string.
        if (signal?.aborted) {
          reject(new Error("Human-in-the-loop interaction aborted"));
          return;
        }

        resolvePromiseRef.current = resolve;

        if (signal) {
          const onAbort = () => {
            cleanupAbortRef.current = null;
            resolvePromiseRef.current = null;
            reject(new Error("Human-in-the-loop interaction aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
          cleanupAbortRef.current = () => {
            signal.removeEventListener("abort", onAbort);
          };
        }
      });
    },
    [],
  );

  const RenderComponent: ReactToolCallRenderer<T>["render"] = useCallback(
    (props) => {
      const ToolComponent = tool.render;

      // Build the HITL render props per status. `props` already carries
      // `toolCallId`; we overwrite `name`/`description` with the tool's
      // registration values and add the registration `agentId`, so the HITL
      // render always receives the full prop contract. `respond` is only live
      // while the tool is executing.
      if (props.status === ToolCallStatus.InProgress) {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === ToolCallStatus.Executing) {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === ToolCallStatus.Complete) {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      }

      // ToolCallStatus has only the three states handled above, so this point
      // is unreachable and `props` narrows to `never`. The assignment turns a
      // newly-added status into a compile error here — forcing it to get its
      // own branch above — instead of silently rendering without `respond`.
      const exhaustiveCheck: never = props;
      return exhaustiveCheck;
    },
    [tool.render, tool.name, tool.description, tool.agentId, respond],
  );

  const frontendTool: ReactFrontendTool<T> = {
    ...tool,
    handler,
    render: RenderComponent,
  };

  useFrontendTool(frontendTool, deps);

  // Human-in-the-loop tools should remove their renderer on unmount
  // since they can't respond to user interactions anymore
  useEffect(() => {
    return () => {
      copilotkit.removeHookRenderToolCall(tool.name, tool.agentId);
    };
  }, [copilotkit, tool.name, tool.agentId]);
}
