/**
 * Frontend slugs the CLI's onboarding graph accepts.
 *
 * Source of truth: `ONBOARDING_FRONTENDS` in the Intelligence repo at
 * `apps/cli/src/services/onboarding-classification.ts`. Duplicated as a
 * literal here because the two repos ship separately; re-check that file when
 * the graph gains or loses a frontend.
 *
 * The sibling of `intelligence-onboarding-framework.ts`, built the same way:
 * the graph settles the agent framework first and the frontend second, and
 * the copied prompt names both so it has to ask neither.
 */
const ONBOARDING_FRONTENDS = new Set([
  "angular",
  "nextjs",
  "react-native",
  "react-spa",
  "vue",
]);

/**
 * Docs frontend ids the graph spells differently. Every other id is passed
 * through unchanged and then checked against the graph's set, so only the
 * genuine disagreements need listing.
 *
 * `react` is the docs' default frontend, served at the unprefixed root
 * (`/quickstart`), and the graph calls that same frontend `nextjs`: its
 * `onboarding-prompts/frontend/nextjs.md` is the only frontend prompt whose
 * documentation link is the unprefixed `https://docs.copilotkit.ai/quickstart.md`
 * — every other one points at its own prefixed page (`/vue.md`, `/angular.md`,
 * `/react-spa.md`, `/react-native.md`). Same frontend, spelled differently on
 * each side.
 */
const DOCS_FRONTEND_RENAMES: Record<string, string> = {
  react: "nextjs",
};

/**
 * Maps a docs frontend id to the onboarding graph's frontend slug. Returns
 * undefined when the graph has no equivalent.
 *
 * Frontends the graph does not know (today `slack` and `teams`) deliberately
 * map to nothing: they are chat channels rather than application frontends,
 * the graph has no node for either, and naming them in the prompt would
 * promise a path the CLI cannot walk. Silence lets the graph ask instead.
 */
export function onboardingFrontendSlug(docsId: string): string | undefined {
  const candidate = DOCS_FRONTEND_RENAMES[docsId] ?? docsId;
  return ONBOARDING_FRONTENDS.has(candidate) ? candidate : undefined;
}

/**
 * The sentence appended to the canonical onboarding prompt so the graph does
 * not have to ask which frontend to configure. Returns "" when the frontend
 * has no graph equivalent.
 *
 * Shaped exactly like `frameworkPromptSuffix`, and appended straight after it,
 * because the graph reads the two selections in that order.
 */
export function frontendPromptSuffix(
  docsId: string,
  displayName: string,
): string {
  const graphSlug = onboardingFrontendSlug(docsId);
  if (graphSlug === undefined) {
    return "";
  }
  return ` The developer selected the ${displayName} frontend (\`${graphSlug}\`).`;
}
