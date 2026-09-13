import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";

/**
 * The subset of `CopilotKitCore` that {@link ɵrunMcpFollowUp} depends on.
 * Declared structurally so the runner can be unit-tested without a full core.
 */
export interface ɵMcpFollowUpHost {
  runAgent(params: { agent: AbstractAgent }): Promise<RunAgentResult>;
}

/**
 * Run an MCP app `ui/message` follow-up, scoped to the thread it was enqueued
 * for (issue #5819).
 *
 * The MCP request queue delays follow-up work until the agent is idle. There is
 * a single shared registry agent per id, and switching threads overwrites its
 * `threadId`/`messages` in place. So if the host switches threads while a
 * follow-up is queued, running it now would execute against — and stream into —
 * the now-foreground thread.
 *
 * - **Same thread** (the common case): run on the shared agent, unchanged.
 * - **Thread changed**: the shared agent has moved on, so the follow-up can no
 *   longer run in its originating thread's context. Drop it rather than leak it
 *   into the current thread. (The MCP app already received its `ui/message` ack
 *   at enqueue time; only the optional agent turn is skipped.)
 *
 * @internal exported for testing.
 */
export async function ɵrunMcpFollowUp({
  host,
  agent,
  capturedThreadId,
}: {
  host: ɵMcpFollowUpHost;
  agent: AbstractAgent;
  capturedThreadId: string;
}): Promise<RunAgentResult> {
  const currentThreadId = agent.threadId || "default";
  const originThreadId = capturedThreadId || "default";

  if (currentThreadId === originThreadId) {
    return host.runAgent({ agent });
  }

  console.warn(
    "[MCPAppsRenderer] ui/message follow-up dropped: the thread changed " +
      `(${originThreadId} → ${currentThreadId}) between enqueue and execution, ` +
      "so running it would leak into the now-foreground thread.",
  );
  return { result: undefined, newMessages: [] };
}
