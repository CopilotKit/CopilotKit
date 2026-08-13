/**
 * Properly-typed AG-UI message fixtures for tool-call tests.
 *
 * These exist so no test has to reach for a cast to build a tool result. That
 * matters beyond hygiene: the two things a `result` assertion is supposed to
 * prove — that the renderer received the CONTENT, and that it received it
 * because the ids CORRELATED — are exactly the two things a cast lets a fixture
 * omit. `toolMessage(...)` cannot be built without a `toolCallId`, so a test
 * using it always states which call the result belongs to.
 */
import type { AssistantMessage, ToolMessage } from "@ag-ui/client";

/**
 * An AG-UI `ToolMessage` — a tool result for ONE tool call.
 *
 * `toolCallId` is the first positional argument and has no default on purpose:
 * it is the key `CopilotChat` builds its `toolCallId -> ToolMessage` correlation
 * map on (and the key `renderToolCall` reports `status: "complete"` from). A
 * fixture that omits it still satisfies `useRenderToolCall` — the hook takes the
 * message it is handed and never checks the id — so the correlation goes
 * untested unless the test names the id itself.
 */
export function toolMessage(
  toolCallId: string,
  content: string,
  id = `tool-${toolCallId}`,
): ToolMessage {
  return { id, role: "tool", toolCallId, content };
}

/**
 * An assistant message carrying exactly one function tool call.
 *
 * Typed as `AssistantMessage` rather than left to inference so it can be handed
 * straight to `agent.addMessage` (which takes `Message`) without a cast.
 */
export function assistantToolCall(
  name: string,
  args: string,
  toolCallId = "tc1",
  id = "m1",
): AssistantMessage {
  return {
    id,
    role: "assistant",
    toolCalls: [
      { id: toolCallId, type: "function", function: { name, arguments: args } },
    ],
  };
}
