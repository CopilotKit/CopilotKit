import type { FrontendTool, ToolCallStatus } from "@copilotkit/core";
import type { Component, VNodeChild } from "vue";

/**
 * Props passed to a human-in-the-loop render component, one variant per
 * tool call phase. A Complete call either carries the user's answer in
 * `result`, or, when the run was stopped while waiting on the user, has
 * `aborted: true`, `result: undefined` and the abort message in `error`.
 */
export type VueHumanInTheLoopRenderProps<T> =
  | {
      name: string;
      description: string;
      toolCallId: string;
      agentId?: string;
      args: Partial<T>;
      status: ToolCallStatus.InProgress;
      result: undefined;
      respond: undefined;
      aborted?: undefined;
      error?: undefined;
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
      aborted?: undefined;
      error?: undefined;
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
      aborted?: undefined;
      /** Set when the call failed for a reason other than a stop. */
      error?: string;
    }
  | {
      /**
       * The run was stopped while this request was still waiting on the
       * user. There is no answer: `result` is `undefined`, `aborted` is
       * `true` and `error` holds the abort message, so the UI can show the
       * request as abandoned.
       */
      name: string;
      description: string;
      toolCallId: string;
      agentId?: string;
      args: T;
      status: ToolCallStatus.Complete;
      result: undefined;
      respond: undefined;
      aborted: true;
      error: string;
    };

export type VueHumanInTheLoopRenderFn<T> =
  | ((props: VueHumanInTheLoopRenderProps<T>) => VNodeChild)
  | Component<VueHumanInTheLoopRenderProps<T>>;

export type VueHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  render: VueHumanInTheLoopRenderFn<T>;
};
