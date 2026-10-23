import { createContext } from "react";
import type {
  CopilotChatToolCallDisplay,
  ToolCallLayout,
} from "./tool-call-layout";

/**
 * Handed down by the message view so each message's tool calls and text can
 * follow the view's `toolCallDisplay` without every layer passing it along.
 * @internal
 */
export interface ToolCallDisplayContextValue {
  display: CopilotChatToolCallDisplay;
  isRunning: boolean;
  /** Each assistant message's tool calls, laid out across the whole list. */
  layouts: ReadonlyMap<string, ToolCallLayout>;
  /**
   * `"turn"` display: for each message in a reply's working phase, whether
   * that work is showing. Messages not in here are the reply itself.
   */
  workOpen: ReadonlyMap<string, boolean>;
  /**
   * Like `workOpen`, for the messages' text: text that ends the reply stays
   * out of it even when its message also calls a tool.
   */
  workTextOpen: ReadonlyMap<string, boolean>;
}

/** @internal */
export const ToolCallDisplayContext =
  createContext<ToolCallDisplayContextValue | null>(null);
