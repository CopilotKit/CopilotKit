import { z } from "zod";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import type { VueToolCallRenderer } from "../types/vue-tool-call-renderer";

export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

export const A2UI_BUILT_IN_TOOL_RENDERER_ID = Symbol.for(
  "copilotkit.vue.a2uiBuiltInToolRenderer",
);

export type A2UIBuiltInToolCallRenderer = VueToolCallRenderer<unknown> & {
  [A2UI_BUILT_IN_TOOL_RENDERER_ID]?: true;
};

let builtInRenderer: A2UIBuiltInToolCallRenderer | null = null;

/**
 * Stable built-in no-op renderer for `render_a2ui`.
 * Included in CopilotKitProvider's computed tool-renderer list while A2UI is
 * active; hook/slot registrations continue to override it.
 */
export function getA2UIBuiltInToolCallRenderer(): A2UIBuiltInToolCallRenderer {
  if (!builtInRenderer) {
    builtInRenderer = defineToolCallRenderer({
      name: RENDER_A2UI_TOOL_NAME,
      args: z.any(),
      render: () => null,
    }) as A2UIBuiltInToolCallRenderer;
    builtInRenderer[A2UI_BUILT_IN_TOOL_RENDERER_ID] = true;
  }
  return builtInRenderer;
}

export function isA2UIBuiltInToolCallRenderer(
  renderer: VueToolCallRenderer<unknown>,
): renderer is A2UIBuiltInToolCallRenderer {
  return (
    (renderer as A2UIBuiltInToolCallRenderer)[
      A2UI_BUILT_IN_TOOL_RENDERER_ID
    ] === true
  );
}
