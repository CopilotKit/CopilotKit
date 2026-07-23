import { z } from "zod";

export const RENDER_A2UI_TOOL_NAME = "render_a2ui";
export const AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME = "AGUISendStateSnapshot";
export const RenderA2UIArgsSchema = z.record(z.string(), z.unknown());

export interface RenderA2UIArgs extends Record<string, unknown> {
  items?: unknown[];
  components?: unknown[];
  snapshot?: unknown;
}
