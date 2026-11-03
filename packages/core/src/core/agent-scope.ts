/**
 * True when an entry scoped to `agentIds` goes to a run of `agentId`. An
 * entry without `agentIds` goes to every agent; an entry with them does not
 * go to a run without an agent id. Internal, not exported.
 */
export function isForAgent(
  agentIds: readonly string[] | undefined,
  agentId: string | undefined,
): boolean {
  return (
    agentIds === undefined ||
    (agentId !== undefined && agentIds.includes(agentId))
  );
}
