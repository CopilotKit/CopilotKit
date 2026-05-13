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
  generative_ui?: string[];
  interaction_modalities?: string[];
  /**
   * Implementation pattern for `a2ui-fixed-schema`. Set only when the
   * feature is wired in this integration. Drives `<WhenFrameworkHas>`
   * gating in the docs.
   *
   * - `schema-loading`: backend loads the schema from a JSON file at
   *   startup (e.g. `a2ui.load_schema(path)`).
   * - `schema-inline`: schema is declared inline as a typed literal in
   *   source (e.g. spring-ai `List.of(Map.of(...))`, .NET C# array).
   * - `llm-driven`: backend generates the schema dynamically via a
   *   secondary LLM call (e.g. mastra `generateA2uiTool`, strands
   *   `generate_a2ui` tool).
   */
  a2ui_pattern?: "schema-loading" | "schema-inline" | "llm-driven" | null;
  /**
   * Implementation pattern for `gen-ui-interrupt` / `interrupt-headless`.
   * Set only when at least one is wired.
   *
   * - `native`: framework has a real interrupt primitive (LangGraph
   *   `interrupt()` + `useInterrupt`).
   * - `promise-based`: demo uses `useFrontendTool` with a Promise-based
   *   handler (ms-agent-python, ms-agent-dotnet).
   */
  interrupt_pattern?: "native" | "promise-based" | null;
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

/**
 * Maps a registry slug to the `integrations/<folder>/` directory name
 * that holds its framework-unique docs content. Most slugs match their
 * folder 1:1. These overrides exist because:
 *
 * - Three LangChain/LangGraph URL variants (`-python`, `-typescript`,
 *   `-fastapi`) read from one shared `langgraph/` tree, with
 *   in-page `<Tabs>` and `<TailoredContent>` handling the per-variant
 *   code examples. The URL slug determines which tab opens by default
 *   (see TAB_DEFAULTS_BY_SLUG below).
 * - `microsoft-agent-framework/` serves both `ms-agent-dotnet` and
 *   `ms-agent-python`, same in-page-tabs pattern.
 * - `google-adk` / `strands` are legacy renames — the slug changed in
 *   the registry but the docs folder still uses the earlier name.
 *
 * Unlisted slugs default to the slug itself, so registry entries
 * whose folder already matches their slug need no entry here.
 */
const DOCS_FOLDER_OVERRIDES: Record<string, string> = {
  "langgraph-python": "langgraph",
  "langgraph-typescript": "langgraph",
  "langgraph-fastapi": "langgraph",
  "google-adk": "adk",
  "crewai-crews": "crewai-flows",
  strands: "aws-strands",
  "ms-agent-dotnet": "microsoft-agent-framework",
  "ms-agent-python": "microsoft-agent-framework",
};

export function getDocsFolder(slug: string): string {
  return DOCS_FOLDER_OVERRIDES[slug] ?? slug;
}

/**
 * Per-slug default-tab selections for the in-page `<Tabs>` component,
 * keyed by the MDX `groupId` prop. When a page renders under one of
 * these slugs, any tab whose `groupId` matches opens with the mapped
 * value pre-selected — so `/langgraph-typescript/configurable` opens
 * the TypeScript tab, `/ms-agent-dotnet/auth` opens .NET, etc.
 *
 * The MDX still authors `items={['Python', 'TypeScript']}` once; only
 * the initially-selected label differs per URL variant. Unmapped
 * slugs, or tabs with a `groupId` not listed here, fall back to the
 * component's existing behavior (first label wins).
 */
const TAB_DEFAULTS_BY_SLUG: Record<string, Record<string, string>> = {
  "langgraph-python": {
    language_langgraph_agent: "Python",
    deployment_method: "LangSmith",
  },
  "langgraph-typescript": {
    language_langgraph_agent: "TypeScript",
  },
  "langgraph-fastapi": {
    language_langgraph_agent: "Python",
    deployment_method: "FastAPI",
  },
  "ms-agent-dotnet": {
    "language_microsoft-agent-framework_agent": ".NET",
  },
  "ms-agent-python": {
    "language_microsoft-agent-framework_agent": "Python",
  },
};

export function getTabDefault(
  slug: string | null | undefined,
  groupId: string | undefined,
): string | undefined {
  if (!slug || !groupId) return undefined;
  return TAB_DEFAULTS_BY_SLUG[slug]?.[groupId];
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
