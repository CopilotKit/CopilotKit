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
 * Maps a registry slug to the framework slug expected by
 * feature-viewer.copilotkit.ai (which hosts the Code tab iframe in
 * `<InlineDemo>`). Most slugs differ from `getDocsFolder` because
 * feature-viewer was deployed with its own naming scheme that
 * predates the shell-docs rename pass.
 *
 * Returning `null` means the integration has no feature-viewer
 * counterpart at all; the `<InlineDemo>` Code tab is suppressed in
 * that case (Demo tab still renders).
 *
 * Verified 2026-05-08 by probing each
 * `https://feature-viewer.copilotkit.ai/<slug>/feature/agentic_chat?view=code&sidebar=false&codeLayout=tabs`
 * URL — entries marked `null` returned a hard 404
 * (`NEXT_HTTP_ERROR_FALLBACK;404`); entries returning a value were
 * confirmed to render real code panels for at least one supported
 * demo.
 */
const FEATURE_VIEWER_SLUG_OVERRIDES: Record<string, string | null> = {
  // Three LangChain/LangGraph URL variants share one feature-viewer
  // entry — same as the docs-folder mapping.
  "langgraph-python": "langgraph",
  "langgraph-typescript": "langgraph",
  "langgraph-fastapi": "langgraph",
  // feature-viewer renames `crewai-crews` to `crewai` (the
  // docs-folder uses `crewai-flows`, distinct from both).
  "crewai-crews": "crewai",
  // feature-viewer uses dashed `llama-index`; registry uses
  // unhyphenated `llamaindex`.
  llamaindex: "llama-index",
  // Registry slug `strands`; docs folder `aws-strands`;
  // feature-viewer also uses `aws-strands`.
  strands: "aws-strands",
  // No feature-viewer page exists for these integrations — hide the
  // Code tab on InlineDemo rather than rendering a 404.
  "built-in-agent": null,
  "google-adk": null,
  "claude-sdk-python": null,
  "claude-sdk-typescript": null,
  "ms-agent-python": null,
  "ms-agent-dotnet": null,
};

export function getFeatureViewerSlug(slug: string): string | null {
  if (slug in FEATURE_VIEWER_SLUG_OVERRIDES) {
    return FEATURE_VIEWER_SLUG_OVERRIDES[slug];
  }
  return slug;
}

/**
 * Maps a registry demo ID (after dash→underscore normalization, e.g.
 * `gen_ui_tool_based`) to the demo ID feature-viewer expects (e.g.
 * `tool_based_generative_ui`). The two namespaces diverged historically;
 * feature-viewer keeps its older descriptive names.
 *
 * Returning `null` means feature-viewer has no entry for this demo at
 * all — the `<InlineDemo>` Code tab is suppressed for it. Feature-viewer
 * currently ships only the six canonical demos listed below; everything
 * else (`tool-rendering`, `subagents`, `frontend-tools`, `voice`, etc.)
 * exists in the showcase backends but has no Code-view counterpart.
 *
 * Verified 2026-05-08 against
 * `https://feature-viewer.copilotkit.ai/langgraph/feature/<demo>?view=code&sidebar=false&codeLayout=tabs`
 * — only these six demos rendered real code panels for `langgraph`;
 * any other demo ID returned the `_not-found` page.
 */
const FEATURE_VIEWER_DEMOS: Record<string, string> = {
  // Identity mappings — shell uses the same name as feature-viewer.
  agentic_chat: "agentic_chat",
  // Renames — shell-docs adopted shorter names; feature-viewer kept
  // the original descriptive ones.
  gen_ui_tool_based: "tool_based_generative_ui",
  gen_ui_agent: "agentic_generative_ui",
  shared_state_streaming: "predictive_state_updates",
  shared_state_read_write: "shared_state",
  hitl_in_chat: "human_in_the_loop",
};

export function getFeatureViewerDemoId(demo: string): string | null {
  return FEATURE_VIEWER_DEMOS[demo] ?? null;
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
