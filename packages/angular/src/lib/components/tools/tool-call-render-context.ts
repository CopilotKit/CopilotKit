import { InjectionToken, type Signal } from "@angular/core";

/** A grouped call that never got a result after the run ended is "stopped". */
export type ToolCallRowStatus = "running" | "done" | "failed" | "stopped";

export type CopilotChatToolCallGroupAppearance = "card" | "line" | "stack";

export const toolCallRowStatusLabels: Record<ToolCallRowStatus, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

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

/** The first non-empty string argument: usually a command, path or query. */
export function argumentPreview(parameters: unknown): string | undefined {
  if (!parameters || typeof parameters !== "object") return undefined;
  const value = Object.values(parameters).find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  return value?.replace(/\s+/g, " ");
}
