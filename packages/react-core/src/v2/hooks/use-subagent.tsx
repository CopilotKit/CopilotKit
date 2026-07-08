import { useEffect, useMemo, useState } from "react";
import type { SubagentState } from "@copilotkit/core";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";
import { useCopilotKit } from "../context";
import { useCopilotChatConfiguration } from "../providers/CopilotChatConfigurationProvider";

export interface UseSubagentParams {
  /** The subagent's opaque id (exact, always unambiguous). */
  subagentId?: string;
  /**
   * The declared subagent name (`subagent_type`). Not guaranteed unique — if
   * more than one subagent currently carries this name, the most recently
   * started match is returned, `isAmbiguous`/`matchCount` are set, and a
   * dev-only warning is logged once. Pass `subagentId` for a stable reference.
   */
  subagentName?: string;
  /** Owning agent id. Defaults to the chat's configured agent (like useAgent). */
  agentId?: string;
}

export interface SubagentView extends SubagentState {
  /** True when a `subagentName` lookup matched more than one subagent. */
  isAmbiguous?: boolean;
  /** Number of subagents that matched a `subagentName` lookup (when >1). */
  matchCount?: number;
}

// Dev-only, warn-once dedup across the whole app so an ambiguous name lookup
// doesn't spam the console on every render.
const warnedAmbiguousNames = new Set<string>();

function resolveSubagent(
  subagents: Record<string, SubagentState>,
  subagentId: string | undefined,
  subagentName: string | undefined,
): SubagentView | undefined {
  if (subagentId) {
    const match = subagents[subagentId];
    return match ? { ...match } : undefined;
  }
  if (subagentName) {
    // Insertion order = started order, so the last match is the most recent.
    const matches = Object.values(subagents).filter(
      (s) => s.name === subagentName,
    );
    if (matches.length === 0) {
      return undefined;
    }
    const chosen = matches[matches.length - 1];
    return matches.length > 1
      ? { ...chosen, isAmbiguous: true, matchCount: matches.length }
      : { ...chosen };
  }
  return undefined;
}

/**
 * Read a subagent's live lifecycle state (name, description, running status)
 * from the CopilotKit core subagent registry, by id or by declared name.
 *
 * @example
 * const sub = useSubagent({ subagentId: message.subagentId });
 * // sub?.name, sub?.description, sub?.status
 */
export function useSubagent(
  params: UseSubagentParams,
): SubagentView | undefined {
  const { subagentId, subagentName, agentId } = params;
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const resolvedAgentId = useMemo(
    () => agentId ?? config?.agentId ?? DEFAULT_AGENT_ID,
    [agentId, config?.agentId],
  );

  const [subagent, setSubagent] = useState<SubagentView | undefined>(() =>
    resolveSubagent(
      copilotkit.getSubagents(resolvedAgentId),
      subagentId,
      subagentName,
    ),
  );

  // Resync when the target (agent/id/name) changes.
  useEffect(() => {
    setSubagent(
      resolveSubagent(
        copilotkit.getSubagents(resolvedAgentId),
        subagentId,
        subagentName,
      ),
    );
  }, [copilotkit, resolvedAgentId, subagentId, subagentName]);

  // Subscribe to registry changes for the owning agent.
  useEffect(() => {
    const subscription = copilotkit.subscribe({
      onSubagentsChanged: ({ agentId: changedAgentId, subagents }) => {
        if (changedAgentId !== resolvedAgentId) {
          return;
        }
        setSubagent(resolveSubagent(subagents, subagentId, subagentName));
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [copilotkit, resolvedAgentId, subagentId, subagentName]);

  // Warn once (dev only) when a name lookup is ambiguous.
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" ||
      !subagentName ||
      !subagent?.isAmbiguous
    ) {
      return;
    }
    const key = `${subagentName}:${subagent.matchCount}`;
    if (warnedAmbiguousNames.has(key)) {
      return;
    }
    warnedAmbiguousNames.add(key);
    console.warn(
      `[CopilotKit] useSubagent({ subagentName: ${JSON.stringify(subagentName)} }) ` +
        `matched ${subagent.matchCount} subagents. Returning the most recently ` +
        `started one; pass a subagentId for a stable reference.`,
    );
  }, [subagentName, subagent?.isAmbiguous, subagent?.matchCount]);

  return subagent;
}
