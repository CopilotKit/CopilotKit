/**
 * Per-session store for:
 * 1. SSE event writer (read by before/after_tool_call hooks)
 *
 * Fully reentrant — concurrent requests use different session keys.
 */
const writerStore = new Map();
// --- SSE event writer (for before/after_tool_call hooks) ---
const messageIdStore = new Map();
export function setWriter(sessionKey, writer, messageId) {
  writerStore.set(sessionKey, writer);
  messageIdStore.set(sessionKey, messageId);
}
export function getWriter(sessionKey) {
  return writerStore.get(sessionKey);
}
export function getMessageId(sessionKey) {
  return messageIdStore.get(sessionKey);
}
export function clearWriter(sessionKey) {
  writerStore.delete(sessionKey);
  messageIdStore.delete(sessionKey);
}
// --- Pending toolCallId stack (before_tool_call pushes, tool_result_persist pops) ---
// Only used for SERVER-side tools. Client tools emit TOOL_CALL_END in
// before_tool_call and never push to this stack.
const pendingStacks = new Map();
export function pushToolCallId(sessionKey, toolCallId) {
  let stack = pendingStacks.get(sessionKey);
  if (!stack) {
    stack = [];
    pendingStacks.set(sessionKey, stack);
  }
  stack.push(toolCallId);
}
export function popToolCallId(sessionKey) {
  const stack = pendingStacks.get(sessionKey);
  const id = stack?.pop();
  if (stack && stack.length === 0) {
    pendingStacks.delete(sessionKey);
  }
  return id;
}
// --- Client tool name tracking ---
// Tracks which tool names are client-provided so hooks can distinguish them.
const clientToolNames = new Map();
export function markClientToolNames(sessionKey, names) {
  clientToolNames.set(sessionKey, new Set(names));
}
export function isClientTool(sessionKey, toolName) {
  return clientToolNames.get(sessionKey)?.has(toolName) ?? false;
}
export function clearClientToolNames(sessionKey) {
  clientToolNames.delete(sessionKey);
}
// --- Client-tool-called flag ---
// Set when a client tool is invoked during a run so the dispatcher can
// suppress text output and end the run after the tool call events.
const clientToolCalledFlags = new Map();
export function setClientToolCalled(sessionKey) {
  clientToolCalledFlags.set(sessionKey, true);
}
export function wasClientToolCalled(sessionKey) {
  return clientToolCalledFlags.get(sessionKey) ?? false;
}
export function clearClientToolCalled(sessionKey) {
  clientToolCalledFlags.delete(sessionKey);
}
