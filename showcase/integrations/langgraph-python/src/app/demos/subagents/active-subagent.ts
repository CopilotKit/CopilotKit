import { Delegation, SubAgentName } from "./delegation-log";

// Inspect the live message stream to find the most recent supervisor
// tool call to a sub-agent that has not yet produced a ToolMessage
// reply. Falls back to `null` when there is no in-flight delegation.
//
// This is intentionally defensive — the v2 message shape can vary
// across runtime versions, so we structurally probe instead of
// relying on a specific TS type.
type RawToolCall = {
  id?: string | null;
  function?: { name?: string | null; arguments?: string | null } | null;
};

type RawMessage = {
  role?: string;
  toolCalls?: RawToolCall[] | null;
  toolCallId?: string | null;
  content?: unknown;
};

export function inferActiveSubAgent(
  delegations: Delegation[],
  messages: unknown,
): { subAgent: SubAgentName; task: string } | null {
  const msgs: RawMessage[] = Array.isArray(messages)
    ? (messages as RawMessage[])
    : [];

  // Collect every tool_call_id that already has a matching tool reply.
  const repliedIds = new Set<string>();
  for (const m of msgs) {
    if (m.role === "tool" && typeof m.toolCallId === "string") {
      repliedIds.add(m.toolCallId);
    }
  }

  const SUB_AGENT_NAMES: ReadonlySet<SubAgentName> = new Set<SubAgentName>([
    "research_agent",
    "writing_agent",
    "critique_agent",
  ]);

  // Walk newest → oldest and return the most recent unanswered call.
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (!m || m.role !== "assistant" || !Array.isArray(m.toolCalls)) continue;
    for (let j = m.toolCalls.length - 1; j >= 0; j--) {
      const call = m.toolCalls[j];
      const name = call?.function?.name;
      if (typeof name !== "string") continue;
      if (!SUB_AGENT_NAMES.has(name as SubAgentName)) continue;
      if (typeof call?.id === "string" && repliedIds.has(call.id)) continue;
      const task = extractTask(call?.function?.arguments);
      return { subAgent: name as SubAgentName, task };
    }
  }

  // Fall back: if delegations is non-empty but the supervisor is still
  // running, surface the most recent delegation as a soft signal.
  if (delegations.length > 0) {
    const last = delegations[delegations.length - 1];
    if (last && last.status !== "completed") {
      return { subAgent: last.sub_agent, task: last.task };
    }
  }
  return null;
}

function extractTask(rawArgs: string | null | undefined): string {
  if (!rawArgs) return "(preparing task…)";
  // Streaming tool args may be a partial JSON string. Try a strict
  // parse first, then fall back to a regex sniff for `"task": "..."`.
  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === "object" && "task" in parsed) {
      const t = (parsed as { task?: unknown }).task;
      if (typeof t === "string" && t.trim().length > 0) return t;
    }
  } catch {
    const match = rawArgs.match(/"task"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (match && match[1].length > 0) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1];
      }
    }
  }
  return "(preparing task…)";
}
