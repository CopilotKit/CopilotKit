type DelegationMessage = {
  role?: string;
  toolCalls?: {
    id: string;
    function?: { name?: string };
    name?: string;
  }[];
};

/**
 * Return the FIRST delegation of every user turn that contains one, in order.
 *
 * A top-level agent delegates before any of its subagents can delegate again,
 * so the first matching tool call after a user message is the stable parent
 * anchor for that turn. Each such call gets its own console, so every run's
 * progress stays beside the turn that started it, including on a restored
 * thread (message order is persisted; the live event stream is not).
 */
export const findDelegationAnchorToolCallIds = (
  messages: readonly DelegationMessage[],
  toolName = "task",
): string[] => {
  const anchors: string[] = [];
  let sawDelegationThisTurn = false;

  for (const message of messages) {
    if (message.role === "user") {
      sawDelegationThisTurn = false;
      continue;
    }
    if (message.role !== "assistant" || sawDelegationThisTurn) continue;

    for (const call of message.toolCalls ?? []) {
      if ((call.function?.name ?? call.name) !== toolName) continue;
      anchors.push(call.id);
      sawDelegationThisTurn = true;
      break;
    }
  }

  return anchors;
};

type DelegationSubagent = {
  subagentRunId: string;
  parentSubagentRunId?: string;
  parentToolCallId?: string;
};

type DelegationLine = { subagentRunId: string };

/** The top-level subagent a (possibly nested) subagent run descends from. */
const rootOf = <S extends DelegationSubagent>(
  subagents: ReadonlyMap<string, S>,
  subagentRunId: string,
): S | undefined => {
  let current = subagents.get(subagentRunId);
  const seen = new Set<string>();
  while (current?.parentSubagentRunId && !seen.has(current.subagentRunId)) {
    seen.add(current.subagentRunId);
    const parent = subagents.get(current.parentSubagentRunId);
    if (!parent) return undefined;
    current = parent;
  }
  return current;
};

/**
 * The lines and subagents of the ONE subagent tree a delegation started.
 *
 * The accumulator is per thread, so a second run's activity sits next to the
 * first's. `SUBAGENT_STARTED` carries the parent's `parentToolCallId`; a line
 * belongs to a delegation when its subagent's top-level ancestor was started by
 * that tool call. When no top-level subagent carries a `parentToolCallId` (an
 * older adapter), nothing can be attributed, so every line is shown, as before.
 */
export const selectDelegationActivity = <
  L extends DelegationLine,
  S extends DelegationSubagent,
>(
  lines: readonly L[],
  subagents: ReadonlyMap<string, S>,
  delegationToolCallId: string | undefined,
): { lines: L[]; subagents: S[]; scoped: boolean } => {
  const all = Array.from(subagents.values());
  const attributable = all.some(
    (s) => !s.parentSubagentRunId && s.parentToolCallId,
  );
  if (!delegationToolCallId || !attributable) {
    return { lines: [...lines], subagents: all, scoped: false };
  }

  const inTree = new Set(
    all
      .filter(
        (s) =>
          rootOf(subagents, s.subagentRunId)?.parentToolCallId ===
          delegationToolCallId,
      )
      .map((s) => s.subagentRunId),
  );
  return {
    lines: lines.filter((line) => inTree.has(line.subagentRunId)),
    subagents: all.filter((s) => inTree.has(s.subagentRunId)),
    scoped: true,
  };
};
