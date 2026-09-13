/**
 * Describe the concrete outcome a page-action prompt should request after
 * the canonical CLI onboarding flow. A `snippet_cell` is the docs contract
 * that the page represents a Showcase feature; quickstarts and references do
 * not carry one, so their prompt deliberately remains generic.
 */
export function onboardingFeaturePromptSuffix(input: {
  cell?: string;
  title: string;
  description?: string;
}): string {
  if (!input.cell) return "";

  const goal = input.description ? ` Its goal: ${input.description}` : "";
  return ` After onboarding, implement the Showcase feature “${input.title}” in this app.${goal} Follow the linked guide.`;
}
