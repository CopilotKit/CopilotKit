import { onboardingFrameworkSlug } from "@/lib/intelligence-onboarding-framework";
import {
  onboardingFrontendName,
  onboardingFrontendSlug,
} from "@/lib/intelligence-onboarding-frontend";
import {
  ARGUMENT_TEMPLATES,
  fillArgumentTemplate,
} from "@/lib/onboarding-argument-templates";

/**
 * The sentence that says what a docs page covers. Returns "" when the page
 * names nothing the onboarding graph knows.
 *
 * A hint, not a claim: in a folder with no project yet, the graph asks only
 * for choices the repository does not show, so the page's framework and
 * frontend are the best default the agent has. Naming one the graph has no
 * node for would suggest a path the CLI cannot walk, so those stay out.
 */
export function pageTopicSentence(
  framework: { slug: string; name: string } | undefined,
  frontend: { id: string; name: string } | undefined,
): string {
  const knownFramework =
    framework && onboardingFrameworkSlug(framework.slug) !== undefined
      ? framework.name
      : undefined;
  const frontendSlug = frontend
    ? onboardingFrontendSlug(frontend.id)
    : undefined;
  const knownFrontend =
    frontend && frontendSlug !== undefined
      ? onboardingFrontendName(frontendSlug, frontend.name)
      : undefined;

  if (knownFramework && knownFrontend) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFrameworkFrontend, {
      framework: knownFramework,
      frontend: knownFrontend,
    });
  }
  if (knownFramework) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFramework, {
      framework: knownFramework,
    });
  }
  if (knownFrontend) {
    return fillArgumentTemplate(ARGUMENT_TEMPLATES.pageTopicFrontend, {
      frontend: knownFrontend,
    });
  }
  return "";
}
