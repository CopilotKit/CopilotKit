import { watch } from "vue";
import type { ShallowRef } from "vue";
import * as z from "zod";
import { ɵRENDER_A2UI_TOOL_NAME as RENDER_A2UI_TOOL_NAME } from "@copilotkit/core";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";

/**
 * Registers a no-op renderer for the `render_a2ui` tool call so its raw
 * streamed args are never surfaced in the transcript, as React does.
 *
 * The generation skeleton / retry / failure UX is not owned here: the A2UI
 * middleware drives the whole lifecycle on the `a2ui-surface` activity (one
 * stable messageId, building → retrying → failed → painted), rendered in place
 * by `createA2UIMessageRenderer`. A skeleton per tool call would duplicate on
 * retries and multi-call generations and linger after the surface painted.
 *
 * It is a built-in renderer, so a `renderToolCalls` entry or a
 * `useRenderTool({ name: "render_a2ui" })` hook replaces it, and setting the
 * provider's renderers never removes it.
 *
 * Call from the provider's setup function and pass a cleanup callback.
 */
export function registerA2UIBuiltInToolCallRenderer(
  copilotkit: ShallowRef<CopilotKitCoreVue>,
  enabled: () => boolean,
): void {
  watch(
    [() => copilotkit.value, enabled],
    ([core, isEnabled], _prev, onCleanup) => {
      if (!isEnabled) return;

      const renderer = defineToolCallRenderer({
        name: RENDER_A2UI_TOOL_NAME,
        args: z.any(),
        // Render nothing: the a2ui-surface activity owns all generation UX.
        render: () => null,
      });

      onCleanup(core.ɵaddBuiltInRenderToolCall(renderer));
    },
    { immediate: true },
  );
}
