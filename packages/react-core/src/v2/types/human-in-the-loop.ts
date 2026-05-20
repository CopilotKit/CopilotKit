import { FrontendTool, ToolCallStatus } from "@copilotkit/core";
import React from "react";

/**
 * Options for a single `respond()` call from a `useHumanInTheLoop` handler.
 *
 * Fields here override the tool's design-time configuration for the duration
 * of one response. Anything not set falls back to the value the tool was
 * registered with.
 */
export interface RespondOptions {
  /**
   * Override the tool's design-time `followUp` for this single response.
   * - `undefined` (default): keep the value the tool was registered with.
   * - `true`: agent re-runs after the response is delivered.
   * - `false`: agent does not re-run.
   */
  followUp?: boolean;
}

export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  render: React.ComponentType<
    | {
        name: string;
        description: string;
        args: Partial<T>;
        status: ToolCallStatus.InProgress;
        result: undefined;
        respond: undefined;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: ToolCallStatus.Executing;
        result: undefined;
        respond: (result: unknown, options?: RespondOptions) => Promise<void>;
      }
    | {
        name: string;
        description: string;
        args: T;
        status: ToolCallStatus.Complete;
        result: string;
        respond: undefined;
      }
  >;
};
