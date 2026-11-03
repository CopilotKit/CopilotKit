import * as z from "zod";
import { ɵRENDER_A2UI_TOOL_NAME } from "@copilotkit/core";

export { AGUI_SEND_STATE_SNAPSHOT_TOOL_NAME } from "@copilotkit/a2ui-renderer/engine";

/** The tool the A2UI middleware injects so the model can generate a surface. */
export const RENDER_A2UI_TOOL_NAME = ɵRENDER_A2UI_TOOL_NAME;
export const RenderA2UIArgsSchema = z.record(z.string(), z.unknown());

export interface RenderA2UIArgs extends Record<string, unknown> {
  items?: unknown[];
  components?: unknown[];
  snapshot?: unknown;
}
