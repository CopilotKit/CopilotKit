import { useEffect } from "react";
import { ɵRENDER_A2UI_TOOL_NAME as RENDER_A2UI_TOOL_NAME } from "@copilotkit/core";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { defineToolCallRenderer } from "../types/defineToolCallRenderer";
import * as z from "zod";

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
 * It is a built-in renderer, so a `renderToolCalls` entry or a
 * `useRenderTool({ name: "render_a2ui" })` hook replaces it, and it never
 * removes the app's renderers. It is removed when A2UI turns off.
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

    return copilotkit.ɵaddBuiltInRenderToolCall(renderer);
  }, [copilotkit]);

  return null;
}
