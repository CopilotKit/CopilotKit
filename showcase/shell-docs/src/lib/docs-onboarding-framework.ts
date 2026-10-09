// The `onboardingFramework` prop every route hands to `DocsPageView`: the
// docs registry slug plus the display name the copied onboarding prompt
// should call that framework.
//
// Shared by every route that renders a docs page — the framework-scoped one
// (`app/[framework]/[[...slug]]/page.tsx`), the root surface
// (`components/unscoped-docs-page.tsx`) and the cookbook — so the display-name
// override below cannot exist on one surface and not the others. A surface
// with no framework in the URL passes `ROOT_FRAMEWORK`: the Built-in Agent is
// what a reader there has selected, not the absence of a selection.

import { getIntegration } from "@/lib/registry";

/**
 * Display names that deliberately differ from the registry's `name`, because
 * the prompt substitutes the name into a sentence the registry name does not
 * fit grammatically.
 *
 * `built-in-agent` is registered as "CopilotKit's Built-in Agent", which
 * `frameworkPromptSuffix` renders as "the CopilotKit's Built-in Agent agent
 * framework". The template already supplies the word "agent", so the name is
 * trimmed to "Built-in" here and the sentence reads "the Built-in agent
 * framework". That template is shared with the hero button and with every
 * other framework, so the name is corrected at the call site rather than by
 * special-casing the template.
 */
const PROMPT_DISPLAY_NAMES: Record<string, string> = {
  "built-in-agent": "Built-in",
};

/**
 * The `onboardingFramework` prop for a `DocsPageView`, or undefined when the
 * caller has no slug to resolve or the slug has no registry record (`a2a`,
 * `agent-spec`). Such a page renders no onboarding button rather than one
 * whose prompt would name a framework the registry cannot confirm a display
 * name for.
 *
 * Callers decide WHICH slug to pass; this function only refuses the ones the
 * registry does not know. Every docs surface has one to pass — a URL-scoped
 * framework, or `ROOT_FRAMEWORK` where the URL names none.
 */
export function onboardingFrameworkFor(
  slug: string | null | undefined,
): { slug: string; name: string } | undefined {
  if (!slug) return undefined;
  const registryName = getIntegration(slug)?.name;
  if (!registryName) return undefined;
  return { slug, name: PROMPT_DISPLAY_NAMES[slug] ?? registryName };
}
