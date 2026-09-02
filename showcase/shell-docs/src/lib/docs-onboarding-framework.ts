// The `onboardingFramework` prop every route hands to `DocsPageView`: the
// docs registry slug plus the display name the copied onboarding prompt
// should call that framework.
//
// Shared between the framework-scoped route
// (`app/[framework]/[[...slug]]/page.tsx`) and the root surface
// (`components/unscoped-docs-page.tsx`), which are the two places that can
// render a Built-in Agent page. Keeping it in one place is what stops the
// display-name override below from existing on one surface and not the other.

import { getIntegration } from "@/lib/registry";

/**
 * Display names that deliberately differ from the registry's `name`, because
 * the prompt substitutes the name into a sentence the registry name does not
 * fit grammatically.
 *
 * `built-in-agent` is registered as "CopilotKit's Built-in Agent", which
 * `frameworkPromptSuffix` renders as "the CopilotKit's Built-in Agent agent
 * framework" — broken English. That sentence template is shared with the hero
 * button and with every other framework, so the name is corrected here at the
 * call site rather than by special-casing the template.
 */
const PROMPT_DISPLAY_NAMES: Record<string, string> = {
  "built-in-agent": "Built-in Agent",
};

/**
 * The `onboardingFramework` prop for a `DocsPageView`, or undefined when
 * there is no framework to name — a frontend route with no backend selected
 * (`/vue/using-these-docs`), a genuinely frameworkless root page (`/faq`), or
 * a docs-only slug with no registry record (`a2a`, `agent-spec`). Those pages
 * then render no onboarding button rather than a button whose prompt would
 * name a framework the registry cannot confirm a display name for.
 */
export function onboardingFrameworkFor(
  slug: string | null | undefined,
): { slug: string; name: string } | undefined {
  if (!slug) return undefined;
  const registryName = getIntegration(slug)?.name;
  if (!registryName) return undefined;
  return { slug, name: PROMPT_DISPLAY_NAMES[slug] ?? registryName };
}
