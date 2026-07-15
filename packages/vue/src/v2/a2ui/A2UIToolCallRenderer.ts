import { watch } from "vue";
import type { ShallowRef } from "vue";
import { z } from "zod";
import type { CopilotKitCoreVue } from "../lib/vue-core";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";

const RENDER_A2UI_TOOL_NAME = "render_a2ui";

/**
 * Registers a no-op renderer for the `render_a2ui` tool call so its raw streamed
 * args are never surfaced in the transcript.
 *
 * The generation skeleton / retry / failure UX is owned by the `a2ui-surface`
 * activity. Users can still override with `useRenderTool({ name: "render_a2ui" })`
 * or tool slots, which take precedence over this built-in registration.
 *
 * Vue-specific correction: on deactivation, remove only the built-in registration
 * and leave user hook/slot registrations intact.
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
        render: () => null,
      });

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
