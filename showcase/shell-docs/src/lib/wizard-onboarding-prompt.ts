import { frameworkPromptSuffix } from "@/lib/intelligence-onboarding-framework";
import { frontendPromptSuffix } from "@/lib/intelligence-onboarding-frontend";
import { createIntelligenceOnboardingPrompt } from "@/lib/intelligence-onboarding-prompt";
import {
  ARGUMENT_TEMPLATES,
  fillArgumentTemplate,
} from "@/lib/onboarding-argument-templates";

/** The wizard's picks, translated into the coding-agent prompt. */
export interface WizardPromptSelection {
  backend: { id: string; name: string } | null;
  frontend: { id: string; name: string } | null;
  featureTitles: readonly string[];
  /** The wizard's first-step answer to "Do you already have a project?".
   *  `null` when unanswered (the unreachable case of composing a prompt
   *  before step 1, mirrored from `backend`/`frontend` above). Unlike those
   *  two, this has no CLI graph slug to translate -- see the sentence it
   *  drives, below. */
  project: "yes" | "no" | null;
  agent?: "yes" | "no" | null;
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
 * The project and features sentences come last and have no CLI axis at all:
 * the graph classifies the starting state itself by inspecting the
 * repository the coding agent is dropped into, and its classification
 * matrix is starting-state × agent-framework × frontend, with no node for
 * a CopilotKit feature either. Naming the project answer and the features
 * here is advisory prose for the coding agent to read, not a selection the
 * graph can walk or a starting state it steers -- unlike the framework and
 * frontend sentences, which each name a graph slug, this pair just tells
 * the coding agent what the developer said.
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
  const frontendSentence =
    selection.frontend?.id === "slack" || selection.frontend?.id === "teams"
      ? fillArgumentTemplate(ARGUMENT_TEMPLATES.wizardChannelsFrontend, {
          name: selection.frontend.name,
          id: selection.frontend.id,
        })
      : selection.frontend
        ? frontendPromptSuffix(selection.frontend.id, selection.frontend.name)
        : "";
  // Advisory prose naming which of the two the developer said, not an
  // instruction to the graph (see the header comment above). Omitted when
  // unanswered, the same as a framework or frontend the graph doesn't
  // recognize.
  const projectSentence =
    selection.project === "yes"
      ? ARGUMENT_TEMPLATES.wizardProjectExisting
      : selection.project === "no"
        ? ARGUMENT_TEMPLATES.wizardProjectNew
        : "";
  // Omitted entirely for an empty list rather than rendered as an empty
  // clause — there is nothing to append, and it wasn't the previous
  // sentence's concern the way "" is for a framework or frontend the graph
  // doesn't recognize.
  const featuresSentence =
    selection.featureTitles.length > 0
      ? fillArgumentTemplate(ARGUMENT_TEMPLATES.wizardFeatures, {
          titles: selection.featureTitles.join(", "),
        })
      : "";

  return (
    createIntelligenceOnboardingPrompt(runId) +
    frameworkSentence +
    frontendSentence +
    projectSentence +
    (selection.agent === "yes"
      ? fillArgumentTemplate(ARGUMENT_TEMPLATES.wizardAgentExisting, {
          name: selection.backend?.name ?? "working",
        })
      : selection.agent === "no"
        ? fillArgumentTemplate(ARGUMENT_TEMPLATES.wizardAgentNew, {
            name: selection.backend?.name ?? "AI",
          })
        : "") +
    featuresSentence
  );
}
