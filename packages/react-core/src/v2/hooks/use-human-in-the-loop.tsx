import { useCopilotKit } from "../context";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactHumanInTheLoop } from "../types/human-in-the-loop";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { useCallback, useEffect, useRef } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";

export function useHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
>(tool: ReactHumanInTheLoop<T>, deps?: ReadonlyArray<unknown>) {
  const { copilotkit } = useCopilotKit();
  const resolvePromiseRef = useRef<((result: unknown) => void) | null>(null);

  const respond = useCallback(async (result: unknown) => {
    if (resolvePromiseRef.current) {
      resolvePromiseRef.current(result);
      resolvePromiseRef.current = null;
    }
  }, []);

  const handler = useCallback(async () => {
    return new Promise((resolve) => {
      resolvePromiseRef.current = resolve;
    });
  }, []);

  const RenderComponent: ReactToolCallRenderer<T>["render"] = useCallback(
    (props) => {
      const ToolComponent = tool.render;

      // Enhance props based on current status.
      // `props` already carries `toolCallId`; we add the tool's registration
      // `agentId` so the HITL UI can attribute the interrupt to the correct
      // (sub)agent.
      if (props.status === "inProgress") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === "executing") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond,
        };
        return React.createElement(ToolComponent, enhancedProps);
      } else if (props.status === "complete") {
        const enhancedProps = {
          ...props,
          name: tool.name,
          description: tool.description || "",
          agentId: tool.agentId,
          respond: undefined,
        };
        return React.createElement(ToolComponent, enhancedProps);
      }

      // Fallback - just render with original props
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return React.createElement(ToolComponent, props as any);
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
