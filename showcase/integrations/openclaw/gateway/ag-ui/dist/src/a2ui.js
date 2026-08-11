/**
 * A2UI v0.9 detection utilities for tool results.
 *
 * Detects when a server-side tool returns A2UI JSON (the v0.9 wrapper format
 * `{ "a2ui_operations": [...] }`) and provides helpers for grouping operations
 * by surfaceId.
 */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";
/** v0.9 operation keys that identify an A2UI operation object. */
const V09_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
];
/**
 * Extract concatenated text from a `tool_result_persist` event's
 * `message.content` array.
 *
 * The OpenClaw hook provides `event.message` as a ToolResultMessage whose
 * `.content` is `Array<{ type: "text", text: string } | ...>`.  We filter
 * for text blocks and join them.
 */
export function extractToolResultText(content) {
  if (!Array.isArray(content)) return "";
  const texts = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      block.type === "text" &&
      typeof block.text === "string"
    ) {
      texts.push(block.text);
    }
  }
  return texts.join("\n");
}
/**
 * Try to parse a string as A2UI v0.9 operations.
 *
 * Supports the v0.9 wrapper format: `{ "a2ui_operations": [...] }`
 * Returns the operations array, or `null` if not valid A2UI JSON.
 */
export function tryParseA2UIOperations(text) {
  if (!text) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const wrapper = parsed;
  const ops = wrapper[A2UI_OPERATIONS_KEY];
  if (!Array.isArray(ops) || ops.length === 0) return null;
  // Validate that at least the first item looks like an A2UI operation
  const first = ops[0];
  if (typeof first !== "object" || first === null) return null;
  const hasVersionKey = "version" in first;
  const hasOpKey = V09_KEYS.some((k) => k in first);
  if (!hasVersionKey && !hasOpKey) return null;
  return ops;
}
/**
 * Extract `surfaceId` from a single A2UI v0.9 operation.
 */
export function getOperationSurfaceId(op) {
  for (const key of V09_KEYS) {
    const inner = op[key];
    if (typeof inner === "object" && inner !== null && "surfaceId" in inner) {
      return inner.surfaceId;
    }
  }
  return null;
}
/**
 * Group operations by `surfaceId`.  Operations without a surfaceId are
 * placed under the key `"default"`.
 */
export function groupBySurface(ops) {
  const groups = new Map();
  for (const op of ops) {
    const sid = getOperationSurfaceId(op) ?? "default";
    let list = groups.get(sid);
    if (!list) {
      list = [];
      groups.set(sid, list);
    }
    list.push(op);
  }
  return groups;
}
