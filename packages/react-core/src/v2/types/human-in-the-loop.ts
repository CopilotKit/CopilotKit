import type { FrontendTool, ToolCallStatus } from "@copilotkit/core";
import React from "react";

export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  /**
   * Render the human-in-the-loop UI for this tool call.
   *
   * Beyond the tool call's `args`/`status`/`result`, the render props carry
   * attribution:
   * - `toolCallId` — the AG-UI tool call id, unique per interrupt. It is the
   *   stable key for correlating this interrupt with runtime (sub)agent
   *   attribution — e.g. the `agentId` reported by `onToolExecutionStart`, or
   *   per-run attribution stamped on the event stream — so the UI can label
   *   the interrupt with the agent that actually raised it.
   * - `agentId` — the agent this tool was *registered* to (the tool's own
   *   `agentId`), or `undefined` for an unscoped tool. This is the static
   *   registration scope; it is NOT necessarily the runtime (sub)agent that
   *   raised the interrupt. For runtime attribution, correlate `toolCallId`
   *   with the event-stream/`onToolExecutionStart` agent id.
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
