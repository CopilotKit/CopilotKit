/**
 * Agent-framework slugs the CLI's onboarding graph accepts.
 *
 * Source of truth: `ONBOARDING_AGENT_FRAMEWORKS` in the Intelligence repo at
 * `apps/cli/src/services/onboarding-classification.ts`. Duplicated as a
 * literal here because the two repos ship separately; re-check that file when
 * the graph gains or loses a framework.
 */
const ONBOARDING_AGENT_FRAMEWORKS = new Set([
  "ag2",
  "agno",
  "built-in",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "crewai-flows",
  "deep-agents",
  "google-adk",
  "langgraph-fastapi",
  "langgraph-python",
  "langgraph-typescript",
  "llamaindex",
  "mastra",
  "ms-agent-dotnet",
  "ms-agent-harness-dotnet",
  "ms-agent-python",
  "pydantic-ai",
  "strands-python",
  "strands-typescript",
]);

/**
 * Docs slugs the graph spells differently. Every other docs slug is passed
 * through unchanged and then checked against the graph's set, so only the
 * genuine disagreements need listing.
 *
 * `built-in-agent` is the docs slug for the framework the graph calls
 * `built-in`, and `deepagents` the one it calls `deep-agents` — the same
 * frameworks, spelled differently on each side.
 */
const DOCS_SLUG_RENAMES: Record<string, string> = {
  "built-in-agent": "built-in",
  "crewai-crews": "crewai-flows",
  deepagents: "deep-agents",
  strands: "strands-python",
};

/**
 * Maps a docs registry integration slug to the onboarding graph's
 * agent-framework slug. Returns undefined when the graph has no equivalent.
 *
 * Frameworks the graph does not know (today `crewai-conversational-flows`,
 * `langroid` and `spring-ai`) deliberately map to nothing: naming them in the
 * prompt would promise a path the CLI cannot walk. Silence lets the graph ask
 * instead.
 */
export function onboardingFrameworkSlug(docsSlug: string): string | undefined {
  const candidate = DOCS_SLUG_RENAMES[docsSlug] ?? docsSlug;
  return ONBOARDING_AGENT_FRAMEWORKS.has(candidate) ? candidate : undefined;
}

/**
 * The sentence appended to the canonical onboarding prompt so the graph does
 * not have to ask which framework to use. Returns "" when the framework has
 * no graph equivalent.
 */
export function frameworkPromptSuffix(
  docsSlug: string,
  displayName: string,
): string {
  const graphSlug = onboardingFrameworkSlug(docsSlug);
  if (graphSlug === undefined) {
    return "";
  }
  return ` The developer selected the ${displayName} agent framework (\`${graphSlug}\`).`;
}
