import { InjectionToken } from "@angular/core";
import type { Signal } from "@angular/core";
import type { CopilotChatLabels, ɵToolCallRowStatus } from "@copilotkit/core";

/** A grouped call that never got a result after the run ended is "stopped". */
export type ToolCallRowStatus = ɵToolCallRowStatus;

export type CopilotChatToolCallGroupAppearance = "card" | "line" | "stack";

/**
 * The label key for each row status, so a row's status reads from the chat
 * labels in scope.
 * @internal
 */
export const toolCallRowStatusLabelKeys = {
  running: "toolCallStatusRunningLabel",
  done: "toolCallStatusDoneLabel",
  failed: "toolCallStatusFailedLabel",
  stopped: "toolCallStatusStoppedLabel",
} satisfies Record<ToolCallRowStatus, keyof CopilotChatLabels>;

/**
 * Handed to each tool-call renderer through its injector, like React's
 * `ToolCallGroupContext`. Inside a group, `row` is set, so CopilotKit's
 * built-in card draws itself as a compact row that fits the group.
 * @internal
 */
export interface ToolCallRenderContext {
  toolCallId: string;
  row?: {
    appearance: CopilotChatToolCallGroupAppearance;
    status: Signal<ToolCallRowStatus>;
  };
}

/** @internal */
export const TOOL_CALL_RENDER_CONTEXT =
  new InjectionToken<ToolCallRenderContext>("TOOL_CALL_RENDER_CONTEXT");
