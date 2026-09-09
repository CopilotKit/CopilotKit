import { frameworkPromptSuffix } from "@/lib/intelligence-onboarding-framework";
import { frontendPromptSuffix } from "@/lib/intelligence-onboarding-frontend";
import { createIntelligenceOnboardingPrompt } from "@/lib/intelligence-onboarding-prompt";

/** The wizard's picks, translated into the coding-agent prompt. */
export interface WizardPromptSelection {
  backend: { id: string; name: string } | null;
  frontend: { id: string; name: string } | null;
  featureTitles: readonly string[];
}

/**
 * Composes the wizard's coding-agent prompt from a run id and the wizard's
 * selections, in the same order `page-actions.tsx` already uses for the
 * hero button: canonical prompt, then framework, then frontend.
 *
 * Framework before frontend because the CLI's onboarding graph settles the
 * agent framework first and the frontend second — `frontendPromptSuffix`'s
 * own doc comment in `intelligence-onboarding-frontend.ts` says the same
 * thing, and `page-actions.tsx` appends the two suffixes in that order for
 * exactly that reason.
 *
 * The features sentence comes last and has no CLI axis at all: the graph's
 * classification matrix is starting-state × agent-framework × frontend, with
 * no node for a CopilotKit feature. Naming features here is advisory prose
 * for the coding agent to read, not a selection the graph can walk — unlike
 * the framework and frontend sentences, which each name a graph slug.
 */
export function composeWizardOnboardingPrompt(
  runId: string,
  selection: WizardPromptSelection,
): string {
  // "" when the CLI's graph has no node for this pick (see the two suffix
  // helpers' own doc comments) — naming an unsupported slug in the prompt
  // would promise a path the CLI cannot walk, so the sentence is simply
  // omitted and the graph asks instead.
  const frameworkSentence = selection.backend
    ? frameworkPromptSuffix(selection.backend.id, selection.backend.name)
    : "";
  const frontendSentence = selection.frontend
    ? frontendPromptSuffix(selection.frontend.id, selection.frontend.name)
    : "";
  // Omitted entirely for an empty list rather than rendered as an empty
  // clause — there is nothing to append, and it wasn't the previous
  // sentence's concern the way "" is for a framework or frontend the graph
  // doesn't recognize.
  const featuresSentence =
    selection.featureTitles.length > 0
      ? ` They also want these CopilotKit features set up: ${selection.featureTitles.join(", ")}.`
      : "";

  return (
    createIntelligenceOnboardingPrompt(runId) +
    frameworkSentence +
    frontendSentence +
    featuresSentence
  );
}
