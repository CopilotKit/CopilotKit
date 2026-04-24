import registryData from "@/data/registry.json";

export interface Feature {
  id: string;
  name: string;
  category: string;
  description: string;
}

export interface FeatureCategory {
  id: string;
  name: string;
}

export interface Demo {
  id: string;
  name: string;
  description: string;
  tags: string[];
  route?: string;
  command?: string;
  animated_preview_url?: string | null;
}

export interface Integration {
  name: string;
  slug: string;
  category: string;
  language: string;
  logo?: string;
  description: string;
  partner_docs: string | null;
  repo: string;
  copilotkit_version: string;
  backend_url: string;
  deployed: boolean;
  generative_ui?: string[];
  interaction_modalities?: string[];
  sort_order?: number;
  managed_platform?: { name: string; url: string };
  animated_preview_url?: string | null;
  starter?: {
    path: string;
    name: string;
    description?: string;
    github_url?: string;
    demo_url?: string;
    clone_command?: string;
  };
  features: string[];
  demos: Demo[];
}

export interface Registry {
  feature_registry: {
    version: string;
    categories: FeatureCategory[];
    features: Feature[];
  };
  integrations: Integration[];
}

const registry = registryData as Registry;

export function getRegistry(): Registry {
  return registry;
}

export function getIntegrations(): Integration[] {
  return registry.integrations;
}

export function getIntegration(slug: string): Integration | undefined {
  return registry.integrations.find((i) => i.slug === slug);
}

export function getFeatures(): Feature[] {
  return registry.feature_registry.features;
}

export function getFeature(id: string): Feature | undefined {
  return registry.feature_registry.features.find((f) => f.id === id);
}

export function getFeatureCategories(): FeatureCategory[] {
  return registry.feature_registry.categories;
}

export function getIntegrationsByCategory(): Record<string, Integration[]> {
  const grouped: Record<string, Integration[]> = {};
  for (const integration of registry.integrations) {
    if (!grouped[integration.category]) {
      grouped[integration.category] = [];
    }
    grouped[integration.category].push(integration);
  }
  return grouped;
}

export function getDemo(
  integrationSlug: string,
  demoId: string,
): { integration: Integration; demo: Demo } | undefined {
  const integration = getIntegration(integrationSlug);
  if (!integration) return undefined;
  const demo = integration.demos.find((d) => d.id === demoId);
  if (!demo) return undefined;
  return { integration, demo };
}

const CATEGORY_LABELS: Record<string, string> = {
  popular: "Most Popular",
  "agent-framework": "Agent Frameworks",
  "enterprise-platform": "Enterprise",
  "provider-sdk": "Provider SDKs",
  protocol: "Protocols & Standards",
  emerging: "Emerging",
  starter: "Getting Started",
};

export function getCategoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] || slug;
}

const LANGUAGE_LABELS: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  dotnet: ".NET",
};

export function getLanguageLabel(lang: string): string {
  return LANGUAGE_LABELS[lang] || lang;
}
