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
  route: string;
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
  sort_order?: number;
  features: string[];
  demos: Demo[];
}

export interface Registry {
  generated_at: string;
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
