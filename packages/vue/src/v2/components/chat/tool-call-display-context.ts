import type { ComputedRef, InjectionKey } from "vue";
import type {
  CopilotChatToolCallDisplay,
  ToolCallLayout,
} from "./tool-call-layout";

/**
 * Provided by the message view so each message's tool calls follow the view's
 * `toolCallDisplay` without every layer passing it along.
 * @internal
 */
export interface ToolCallDisplayContextValue {
  display: CopilotChatToolCallDisplay;
  isRunning: boolean;
  /** Each assistant message's tool calls, laid out across the whole list. */
  layouts: ReadonlyMap<string, ToolCallLayout>;
}

/** @internal */
export const ToolCallDisplayContextKey: InjectionKey<
  ComputedRef<ToolCallDisplayContextValue>
> = Symbol("CopilotChatToolCallDisplay");

/**
 * Provided by a group around the calls it shows, so CopilotKit's built-in tool
 * card draws itself as a compact row that fits the group instead of a card.
 * @internal
 */
export interface ToolCallGroupContextValue {
  appearance: "card" | "line" | "stack";
  failedIds: ReadonlySet<string>;
  /** The agent may still finish the group's calls; see `isActive`. */
  active: boolean;
}

/** @internal */
export const ToolCallGroupContextKey: InjectionKey<
  ComputedRef<ToolCallGroupContextValue | null>
> = Symbol("CopilotChatToolCallGroup");
