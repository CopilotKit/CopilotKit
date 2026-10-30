import { watch } from "vue";
import type { ShallowRef } from "vue";
import { z } from "zod";
import type { CopilotKitCoreVue } from "../../lib/vue-core";
import { defineToolCallRenderer } from "../../types/defineToolCallRenderer";

/**
 * Tool name used by the dynamic A2UI generation secondary LLM.
 * This renderer is auto-registered when A2UI is enabled.
 */
export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

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
 * The renderer is registered via the props-based `setRenderToolCalls`
 * mechanism (not `useRenderTool`).
 *
 * This ensures user-registered `useRenderTool({ name: "render_a2ui", ... })`
 * hooks automatically override the built-in, since the merge logic in
 * vue-core.ts gives hook-based entries priority over prop-based entries.
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

      // Register via props-based mechanism so useRenderTool hooks take priority
      const existing = core.propRenderToolCalls;
      core.setRenderToolCalls([
        ...existing.filter((rc) => rc.name !== RENDER_A2UI_TOOL_NAME),
        renderer,
      ]);

      onCleanup(() => {
        const current = core.propRenderToolCalls;
        core.setRenderToolCalls(
          current.filter((rc) => rc.name !== RENDER_A2UI_TOOL_NAME),
        );
      });
    },
    { immediate: true },
  );
}
