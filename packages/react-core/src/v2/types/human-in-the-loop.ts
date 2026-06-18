import type { FrontendTool, ToolCallStatus } from "@copilotkit/core";
import React from "react";

export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  /**
   * Render the human-in-the-loop UI for this tool call.
   *
   * Beyond the tool call's `args`/`status`/`result`, the render props carry
   * attribution so the UI can tell which run raised the interrupt:
   * - `toolCallId` — the AG-UI tool call id. Correlate it with the agent
   *   attribution from `onToolExecutionStart` (or with per-run attribution
   *   stamped on the event stream) to render and resume the interrupt against
   *   the correct (sub)agent.
   * - `agentId` — the agent this tool was registered for (the tool's own
   *   `agentId`), or `undefined` when the tool is not agent-scoped.
   */
  render: React.ComponentType<
    | {
        name: string;
        description: string;
        toolCallId: string;
        agentId?: string;
        args: Partial<T>;
        status: ToolCallStatus.InProgress;
        result: undefined;
        respond: undefined;
      }
    | {
        name: string;
        description: string;
        toolCallId: string;
        agentId?: string;
        args: T;
        status: ToolCallStatus.Executing;
        result: undefined;
        respond: (result: unknown) => Promise<void>;
      }
    | {
        name: string;
        description: string;
        toolCallId: string;
        agentId?: string;
        args: T;
        status: ToolCallStatus.Complete;
        result: string;
        respond: undefined;
      }
  >;
};
