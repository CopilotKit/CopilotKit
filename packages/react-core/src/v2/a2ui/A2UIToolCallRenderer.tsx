import { useEffect } from "react";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import { z } from "zod";

/**
 * Tool name used by the dynamic A2UI generation secondary LLM.
 */
export const RENDER_A2UI_TOOL_NAME = "render_a2ui";

/**
 * Registers a no-op renderer for the `render_a2ui` tool call so its raw streamed
 * args are never surfaced in the transcript.
 *
 * The generation skeleton / retry / failure UX is NO LONGER owned here (OSS-162):
 * the A2UI middleware drives the whole lifecycle on the `a2ui-surface` activity
 * (one stable messageId, building → retrying → failed → painted), rendered in
 * place by `createA2UIMessageRenderer`. Owning a skeleton per tool call caused a
 * duplicate skeleton on retries / multi-call generations and a skeleton that
 * lingered after the surface painted — both fixed by retiring it here.
 *
 * Users can still override with their own `useRenderTool({ name: "render_a2ui" })`
 * (hook-based entries take priority over this prop-based registration).
 */
export function A2UIBuiltInToolCallRenderer(): null {
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const renderer = defineToolCallRenderer({
      name: RENDER_A2UI_TOOL_NAME,
      args: z.any(),
      // Render nothing: the a2ui-surface activity owns all generation UX.
      render: () => <></>,
    });

    const existing = (copilotkit as any)._renderToolCalls ?? [];
    copilotkit.setRenderToolCalls([
      ...existing.filter((rc: any) => rc.name !== RENDER_A2UI_TOOL_NAME),
      renderer,
    ]);
  }, [copilotkit]);

  return null;
}
