import { InjectionToken } from "@angular/core";
import type { Signal } from "@angular/core";
import { ɵTOOL_CALL_STATUS_LABEL_KEYS } from "@copilotkit/core";
import type {
  ɵToolCallGroupAppearance,
  ɵToolCallRowStatus,
} from "@copilotkit/core";

/** A grouped call that never got a result after the run ended is "stopped". */
export type ToolCallRowStatus = ɵToolCallRowStatus;

export type CopilotChatToolCallGroupAppearance = ɵToolCallGroupAppearance;

/**
 * The label key for each row status, so a row's status reads from the chat
 * labels in scope.
 * @internal
 */
export const toolCallRowStatusLabelKeys = ɵTOOL_CALL_STATUS_LABEL_KEYS;

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
