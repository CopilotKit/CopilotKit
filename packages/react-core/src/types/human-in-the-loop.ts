import type React from "react";
import type { FrontendTool, HumanInTheLoopRenderProps } from "@copilotkit/core";

/**
 * A human-in-the-loop tool for React. It has no handler: the agent waits until
 * the `render` component calls `respond` with the user's answer.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type ReactHumanInTheLoop<
  T extends Record<string, unknown> = Record<string, unknown>,
> = Omit<FrontendTool<T>, "handler"> & {
  /**
   * Render the human-in-the-loop UI for this tool call. The component
   * receives {@link HumanInTheLoopRenderProps}, which also carry `toolCallId`
   * and `agentId` for attribution.
   */
  render: React.ComponentType<HumanInTheLoopRenderProps<T>>;
};
