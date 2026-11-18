import { InjectionToken, type Signal } from "@angular/core";
import type {
  CopilotChatToolCallDisplay,
  ToolCallLayout,
} from "./tool-call-layout";

/**
 * Provided by the message view so each message's tool calls follow the
 * view's `toolCallDisplay`, like React's `ToolCallDisplayContext`.
 * @internal
 */
export interface ToolCallDisplayContext {
  display: Signal<CopilotChatToolCallDisplay>;
  isRunning: Signal<boolean>;
  /** Each assistant message's tool calls, laid out across the whole list. */
  layouts: Signal<ReadonlyMap<string, ToolCallLayout>>;
  /**
   * `"turn"` display: for each message in a reply's working phase, whether
   * that work is showing. Messages not in here are the reply itself.
   */
  workOpen: Signal<ReadonlyMap<string, boolean>>;
  /**
   * Like `workOpen`, for the messages' text: text that ends the reply stays
   * out of it even when its message also calls a tool.
   */
  workTextOpen: Signal<ReadonlyMap<string, boolean>>;
}

/** @internal */
export const TOOL_CALL_DISPLAY_CONTEXT =
  new InjectionToken<ToolCallDisplayContext>("TOOL_CALL_DISPLAY_CONTEXT");
