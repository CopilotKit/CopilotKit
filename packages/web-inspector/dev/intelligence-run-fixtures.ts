/** The lab creates one distinct customer and conversation for each seeded run. */
export const FIXTURE_RUN_AGENTS = ["support", "billing", "support"] as const;

/** Counts the distinct fixture identities in the selected agent scope. */
export function fixtureIdentityTotal(agentId?: string): number {
  return FIXTURE_RUN_AGENTS.filter((agent) => !agentId || agent === agentId)
    .length;
}
