type DelegationMessage = {
  role?: string;
  toolCalls?: {
    id: string;
    function?: { name?: string };
    name?: string;
  }[];
};

/**
 * Return the FIRST delegation in the most recent user-turn segment that
 * contains one.
 *
 * A top-level agent delegates before any of its subagents can delegate again,
 * so the first matching tool call after a user message is the stable parent
 * anchor for that turn. Keeping the latest such anchor lets repeated delegated
 * runs surface progress beside the turn that started them instead of updating a
 * console far back in thread history.
 */
export const findLatestDelegationToolCallId = (
  messages: readonly DelegationMessage[],
  toolName = "task",
): string | undefined => {
  let latest: string | undefined;
  let sawDelegationThisTurn = false;

  for (const message of messages) {
    if (message.role === "user") {
      sawDelegationThisTurn = false;
      continue;
    }
    if (message.role !== "assistant" || sawDelegationThisTurn) continue;

    for (const call of message.toolCalls ?? []) {
      if ((call.function?.name ?? call.name) !== toolName) continue;
      latest = call.id;
      sawDelegationThisTurn = true;
      break;
    }
  }

  return latest;
};

