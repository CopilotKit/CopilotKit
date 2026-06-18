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

      // Enhance props based on current status. `props` already carries
      // `toolCallId`; we add the tool's registration `agentId` (and the
      // normalized `name`/`description`) so the HITL UI always receives the
      // full attribution contract. `respond` is only live while executing.
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

      // Unreachable today: ToolCallStatus has only the three states handled
      // above, so `props` narrows to `never` here. Kept defensively — if a new
      // status is ever added, still surface name/description/agentId so
      // attribution is not silently dropped. `props` is cast to a record
      // because a `never` cannot be spread directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return React.createElement(ToolComponent, {
        ...(props as Record<string, unknown>),
        name: tool.name,
        description: tool.description || "",
        agentId: tool.agentId,
        respond: undefined,
      } as any);
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
