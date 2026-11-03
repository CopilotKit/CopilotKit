import type React from "react";
import type {
  ToolCallRenderProps,
  ToolCallRendererDef,
} from "@copilotkit/core";

/**
 * A tool call renderer for React: a React component that draws one tool call
 * in the chat. The component receives {@link ToolCallRenderProps}.
 *
 * Pass a list of these to `renderToolCalls` on `CopilotKitProvider`, or build
 * one with `defineToolCallRenderer`.
 *
 * @typeParam T - The shape of the tool arguments.
 */
export type ReactToolCallRenderer<T = unknown> = ToolCallRendererDef<
  T,
  React.ComponentType<ToolCallRenderProps<T>>
>;
