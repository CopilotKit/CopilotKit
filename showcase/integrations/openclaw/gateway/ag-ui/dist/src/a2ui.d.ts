/**
 * A2UI v0.9 detection utilities for tool results.
 *
 * Detects when a server-side tool returns A2UI JSON (the v0.9 wrapper format
 * `{ "a2ui_operations": [...] }`) and provides helpers for grouping operations
 * by surfaceId.
 */
export declare const A2UI_OPERATIONS_KEY = "a2ui_operations";
/**
 * Extract concatenated text from a `tool_result_persist` event's
 * `message.content` array.
 *
 * The OpenClaw hook provides `event.message` as a ToolResultMessage whose
 * `.content` is `Array<{ type: "text", text: string } | ...>`.  We filter
 * for text blocks and join them.
 */
export declare function extractToolResultText(content: unknown): string;
/**
 * Try to parse a string as A2UI v0.9 operations.
 *
 * Supports the v0.9 wrapper format: `{ "a2ui_operations": [...] }`
 * Returns the operations array, or `null` if not valid A2UI JSON.
 */
export declare function tryParseA2UIOperations(
  text: string,
): Array<Record<string, unknown>> | null;
/**
 * Extract `surfaceId` from a single A2UI v0.9 operation.
 */
export declare function getOperationSurfaceId(
  op: Record<string, unknown>,
): string | null;
/**
 * Group operations by `surfaceId`.  Operations without a surfaceId are
 * placed under the key `"default"`.
 */
export declare function groupBySurface(
  ops: Array<Record<string, unknown>>,
): Map<string, Array<Record<string, unknown>>>;
