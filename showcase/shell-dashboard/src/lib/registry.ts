import registryData from "../../../shell/src/data/registry.json";
import { sortOrder } from "./sort-order";

export type FeatureKind = "primary" | "testing";

export interface Feature {
  id: string;
  name: string;
  category: string;
  description: string;
  kind?: FeatureKind;
  og_docs_url?: string;
  shell_docs_url?: string;
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
  animated_preview_url?: string | null;
  /**
   * Informational demos (e.g. `cli-start`) have no runnable route — they just
   * surface a copy-pasteable shell command. When `command` is set, the shell
   * renders a code block with a copy button instead of Demo/Code links.
   */
  command?: string;
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
  /**
   * Per-column docs link overrides sourced from
   * `showcase/packages/<slug>/docs-links.json`. The `shell_docs_path` is a
   * path relative to the shell root; callers combine it with the framework
   * slug to build framework-scoped URLs.
   */
  docs_links?: {
    features: Record<
      string,
      {
        og_docs_url: string | null;
        shell_docs_path: string | null;
      }
    >;
  };
}

export interface Package {
  slug: string;
  name: string;
}

export interface Registry {
  feature_registry: {
    version: string;
    categories: FeatureCategory[];
    features: Feature[];
  };
  integrations: Integration[];
  packages?: Package[];
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

export function getPackages(): Package[] {
  return registry.packages ?? [];
}
