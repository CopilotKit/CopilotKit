import { visibleIntegrations } from "./homepage-map";
import { compareByDisplayOrder } from "./framework-order";

export interface LandingIntegration {
  id: string;
  name: string;
  logoSlug: string;
  logo?: string;
  choices: { slug: string; name: string; secondary?: boolean }[];
}

import { PRIORITY_GROUPS } from "./integration-groups";

/** Group language variants without losing any visible registry destination. */
export function landingIntegrations(): LandingIntegration[] {
  const integrations = visibleIntegrations()
    .slice()
    .sort((a, b) => compareByDisplayOrder(a.slug, b.slug));
  const bySlug = new Map(
    integrations.map((integration) => [integration.slug, integration]),
  );
  const grouped = new Set<string>();
  const result: LandingIntegration[] = [];
  for (const group of PRIORITY_GROUPS) {
    const choices = group.choices.filter((choice) => bySlug.has(choice.slug));
    if (choices.length === 0) continue;
    const first = bySlug.get(choices[0].slug)!;
    choices.forEach((choice) => grouped.add(choice.slug));
    result.push({ ...group, choices, logoSlug: first.slug, logo: first.logo });
  }
  for (const integration of integrations) {
    if (grouped.has(integration.slug)) continue;
    result.push({
      id: integration.slug,
      name: integration.name,
      logoSlug: integration.slug,
      logo: integration.logo,
      choices: [{ slug: integration.slug, name: integration.name }],
    });
  }
  return result;
}
