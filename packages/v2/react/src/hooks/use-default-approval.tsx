import { useCallback, useRef } from "react";
import React from "react";
import { useFrontendTool } from "./use-frontend-tool";
import type { ReactFrontendTool } from "../types/frontend-tool";
import type { ReactToolCallRenderer } from "../types/react-tool-call-renderer";
import { ToolCallStatus } from "@copilotkitnext/core";
import { z } from "zod";
import { DefaultApprovalRenderer } from "../components/DefaultApprovalRenderer";

/**
 * Internal hook that registers a wildcard (`*`) frontend tool with a generic
 * approve/deny UI. When `defaultApproval` is enabled on CopilotKitProvider,
 * any unregistered tool call from the backend will be caught by this wildcard
 * handler and presented to the user for approval.
 *
 * This enables automatic handling of Microsoft Agent Framework's
 * `ApprovalRequiredAIFunction` without requiring manual `useHumanInTheLoop`
 * registration for each tool.
 */
export function useDefaultApproval() {
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

  const RenderComponent: ReactToolCallRenderer<any>["render"] = useCallback(
    (props) => {
      if (props.status === ToolCallStatus.InProgress) {
        return React.createElement(DefaultApprovalRenderer, {
          name: props.name,
          args: props.args as Record<string, unknown>,
          status: props.status,
          result: undefined,
          respond: undefined,
        });
      } else if (props.status === ToolCallStatus.Executing) {
        return React.createElement(DefaultApprovalRenderer, {
          name: props.name,
          args: props.args as Record<string, unknown>,
          status: props.status,
          result: undefined,
          respond,
        });
      } else if (props.status === ToolCallStatus.Complete) {
        return React.createElement(DefaultApprovalRenderer, {
          name: props.name,
          args: props.args as Record<string, unknown>,
          status: props.status,
          result: props.result,
          respond: undefined,
        });
      }

      return null;
    },
    [respond],
  );

  const frontendTool: ReactFrontendTool<any> = {
    name: "*",
    description: "Default approval handler for unregistered tool calls",
    parameters: z.any(),
    handler,
    render: RenderComponent,
    followUp: true,
  };

  useFrontendTool(frontendTool);
}
