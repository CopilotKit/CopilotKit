import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type {
  ReactHumanInTheLoop,
  RespondOptions,
} from "../types/human-in-the-loop";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { useCallback, useEffect, useRef } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

export function useHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const resolvePromiseRef = useRef<((result: unknown) => void) | null>(null);

  const respond = useCallback(
    async (result: unknown, options?: RespondOptions) => {
      if (!resolvePromiseRef.current) return;

      // Stamp the registered tool's `followUp` to the desired value for this
      // response — either the runtime override or the design-time default.
      // Core reads this field synchronously when the awaited handler promise
      // resolves (see run-handler's followUp gate), so we must set it before
      // resolving. Restoring later is unsafe due to async chains in core;
      // instead, every respond() call writes the correct value, so the next
      // call without options correctly falls back to design-time.
      const registered = copilotkit.getTool({
        toolName: tool.name,
        agentId: tool.agentId,
      });
      if (registered) {
        registered.followUp =
          options?.followUp !== undefined ? options.followUp : tool.followUp;
      }

      resolvePromiseRef.current(result);
      resolvePromiseRef.current = null;
    },
    [copilotkit, tool.name, tool.agentId, tool.followUp],
  );

  const handler = useCallback(async () => {
    return new Promise((resolve) => {
      resolvePromiseRef.current = resolve;
    });
  }, []);

  const RenderComponent: ReactToolCallRenderer<T>["render"] = useCallback(
    (props) => {
      const ToolComponent = tool.render;

      // Enhance props based on current status
      if (props.status === "inProgress") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === "executing") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          respond,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === "complete") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      }

      // Fallback - just render with original props
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return React.createElement(ToolComponent, props as any);
    },
    [tool.render, tool.name, tool.description, respond],
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
