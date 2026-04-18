import registryData from "../../../shell/src/data/registry.json";
import { sortOrder } from "./sort-order";

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
  repo: string;
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

const registry = registryData as unknown as Registry;

export function getIntegrations(): Integration[] {
  return [...registry.integrations].sort((a, b) => {
    const aRank = sortOrder[a.slug] ?? a.sort_order ?? 999;
    const bRank = sortOrder[b.slug] ?? b.sort_order ?? 999;
    return aRank - bRank;
  });
}

export function getFeatures(): Feature[] {
  return registry.feature_registry.features;
}

export function getFeatureCategories(): FeatureCategory[] {
  return registry.feature_registry.categories;
}
