import { ɵgetToolCallRendererNames } from "@copilotkit/core";
import type { CopilotKit } from "../../copilotkit";

export type {
  CopilotChatToolCallDisplay,
  ToolCallEntry,
} from "@copilotkit/core";
export type {
  ɵToolCallSegment as ToolCallSegment,
  ɵToolCallLayout as ToolCallLayout,
  ɵToolCallRendererNames as ToolCallRendererNames,
} from "@copilotkit/core";
export {
  ɵgetToolResults as getToolResults,
  ɵgetToolCallLayouts as getToolCallLayouts,
} from "@copilotkit/core";

/**
 * Which tool-call renderers are registered on the Angular `CopilotKit`, for
 * grouping (see `getToolCallLayouts`). Like React's `useToolCallRendererNames`.
 *
 * - Renderers registered with `group: true` group.
 * - Client tools with a component, and human-in-the-loop tools, have a
 *   renderer of their own and never group.
 * - The built-in card (`defaultToolRendering: true`) draws the remaining
 *   tools and groups. A registered `"*"` renderer wins over it.
 *
 * @param copilotKit - The Angular `CopilotKit` service.
 */
export function getToolCallRendererNames(
  copilotKit: Pick<
    CopilotKit,
    | "toolCallRenderConfigs"
    | "clientToolCallRenderConfigs"
    | "humanInTheLoopToolRenderConfigs"
    | "defaultToolRenderingEnabled"
  >,
) {
  const clientToolNames = copilotKit
    .clientToolCallRenderConfigs()
    .filter((entry) => entry.component !== undefined)
    .map((entry) => entry.name);
  const humanInTheLoopNames = copilotKit
    .humanInTheLoopToolRenderConfigs()
    .map((entry) => entry.name);
  return ɵgetToolCallRendererNames(copilotKit.toolCallRenderConfigs(), {
    extraNamed: [...clientToolNames, ...humanInTheLoopNames],
    builtInWildcard: {
      enabled: copilotKit.defaultToolRenderingEnabled,
      groups: true,
    },
  });
}
