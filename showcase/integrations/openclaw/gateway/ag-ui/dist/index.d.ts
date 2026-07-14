import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
export interface BeforeToolCallEvent {
  toolName: string;
  params?: Record<string, unknown>;
}
export interface ToolCallContext {
  sessionKey?: string;
}
/**
 * Handles the `before_tool_call` OpenClaw hook.
 * Emits TOOL_CALL_START + TOOL_CALL_ARGS (and TOOL_CALL_END for client tools).
 */
export declare function handleBeforeToolCall(
  event: BeforeToolCallEvent,
  ctx: ToolCallContext,
): void;
/**
 * Handles the `tool_result_persist` OpenClaw hook.
 * Emits TOOL_CALL_RESULT + TOOL_CALL_END for server-side tools.
 */
export declare function handleToolResultPersist(
  event: Record<string, unknown>,
  ctx: ToolCallContext,
): void;
declare const plugin: {
  id: string;
  name: string;
  description: string;
  configSchema: ReturnType<typeof emptyPluginConfigSchema>;
  register: (api: OpenClawPluginApi) => void;
};
export default plugin;
