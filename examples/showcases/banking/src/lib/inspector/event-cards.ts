/**
 * Pure mapping from raw AG-UI events to inspector timeline cards.
 * Noisy per-token events return null (the timeline shows shape, not spam).
 *
 * Ported from splat-demo (Intelligence #361), trimmed for banking: no demo
 * "beat"/badge metadata, no chart/gated/governance handling. Banking's
 * human-in-the-loop tools mark `hitl-gate`; the memory MCP tools mark `memory`.
 */
export type TimelineCard = {
  kind:
    | "lifecycle"
    | "error"
    | "tool-call"
    | "tool-result"
    | "state"
    | "hitl-gate"
    | "custom"
    | "memory";
  title: string;
  summary: string;
  raw: unknown;
};

/** Durable-memory MCP tools surfaced distinctly in the timeline. */
export const MEMORY_TOOLS = new Set([
  "recall_memory",
  "save_memory",
  "forget_memory",
]);

const MEMORY_TOOL_LABEL: Record<string, string> = {
  recall_memory: "Memory: recalled",
  save_memory: "Memory: saved",
  forget_memory: "Memory: forgot",
};

/**
 * Banking tools that render a human-in-the-loop approval card (registered via
 * `useHumanInTheLoop`). Surfacing them as gates is the HITL story: the timeline
 * shows the agent pausing for approval, not a silent backend call.
 */
export const HITL_TOOLS = new Set([
  "addNewCard",
  "setCardPin",
  "assignPolicyToCard",
  "selectCard",
  "addNoteToTransaction",
  "approveTransaction",
  "openPolicyException",
  "finalizePolicyException",
  "navigateToPageAndPerform",
  "offerWorkflowRecording",
  "awaitDashboardDemonstration",
  "saveLearnedWorkflow",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function eventToCard(event: any): TimelineCard | null {
  switch (event?.type) {
    case "RUN_STARTED":
      return card(
        "lifecycle",
        "Run started",
        "Agent run initialized over AG-UI",
        event,
      );
    case "RUN_FINISHED":
      return card("lifecycle", "Run finished", "Agent run completed", event);
    case "RUN_ERROR":
      return card(
        "error",
        "Run error",
        String(event.message ?? "unknown"),
        event,
      );
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
      return card(
        "state",
        "Shared state sync",
        "Agent state streamed to the UI",
        event,
      );
    case "TOOL_CALL_START": {
      const name = String(event.toolCallName ?? "");
      if (MEMORY_TOOLS.has(name)) {
        return card(
          "memory",
          MEMORY_TOOL_LABEL[name] ?? name,
          "Durable-memory MCP tool invoked",
          event,
        );
      }
      if (HITL_TOOLS.has(name)) {
        return card(
          "hitl-gate",
          `HITL gate: ${name}`,
          "Agent paused for human approval",
          event,
        );
      }
      return card(
        "tool-call",
        `Tool call: ${name}`,
        "Backend tool invoked",
        event,
      );
    }
    case "TOOL_CALL_RESULT":
      return card(
        "tool-result",
        "Tool result",
        "Result returned to the agent",
        event,
      );
    case "CUSTOM":
      return card(
        "custom",
        `Custom event: ${String(event.name ?? "?")}`,
        "",
        event,
      );
    default:
      return null; // TEXT_MESSAGE_*, REASONING_*, TOOL_CALL_ARGS — too noisy
  }
}

function card(
  kind: TimelineCard["kind"],
  title: string,
  summary: string,
  raw: unknown,
): TimelineCard {
  return { kind, title, summary, raw };
}
