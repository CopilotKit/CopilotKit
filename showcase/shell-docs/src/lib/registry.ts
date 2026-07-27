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
  /**
   * How shell-docs renders this framework's docs pages.
   * - `generated` (default): data-driven `FrameworkOverview` + agnostic
   *   root MDX merged with per-framework overrides. Kept for the three
   *   "ready" frameworks (langgraph-{python,typescript}, google-adk).
   * - `authored`: render the per-framework MDX tree under
   *   `content/docs/integrations/<docsFolder>/` with its own sidebar
   *   (built from that folder's meta.json). Root MDX may still be used
   *   as a fallback for intentionally shared pages.
   * - `hidden`: exclude from the docs site entirely — no `/<slug>`
   *   route, no switcher entry. Single toggle for "framework has no
   *   v1 docs to port" (or otherwise should not appear in docs yet).
   *
   * Source of truth: `showcase/integrations/<slug>/manifest.yaml`'s
   * `docs_mode` field.
   */
  docs_mode?: "generated" | "authored" | "hidden";
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
  /**
   * Framework-specific pattern for aligning Enterprise Intelligence
   * Platform threads with an external framework's own persistence/session
   * identifiers.
   *
   * - `langgraph`: explicit CopilotKit thread IDs are forwarded as AG-UI
   *   `threadId` and can be aligned with LangGraph checkpoint/thread IDs
   *   when the backend accepts them.
   * - `adk-session`: CopilotKit thread IDs may be mapped to ADK session
   *   IDs; ADK durability still depends on the configured ADK session
   *   service.
   */
  thread_persistence_pattern?: "langgraph" | "adk-session" | null;
  agent_config_pattern?: "shared-state" | "runtime-properties" | null;
  auth_pattern?:
    | "langgraph"
    | "ag2-context-variables"
    | "microsoft-agent-framework"
    | "runtime-onrequest"
    | null;
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

/**
 * The soft-default framework whose authored docs are served at the ROOT
 * URL surface (`/quickstart`, `/server-tools`, …) instead of under a
 * `/<framework>/` prefix. `/built-in-agent/:path*` permanently
 * redirects to `/:path*` (next.config.ts).
 *
 * Client components must not import this (registry.json would leak into
 * the client bundle) — they use DEFAULT_FRAMEWORK in
 * `components/framework-provider.tsx`, which mirrors this value.
 */
export const ROOT_FRAMEWORK = "built-in-agent";

const DOCS_ONLY_INTEGRATIONS: Integration[] = [
  {
    name: "Deep Agents",
    slug: "deepagents",
    category: "popular",
    language: "python",
    description:
      "LangChain Deep Agents connected to CopilotKit chat, state, tools, and generative UI.",
    partner_docs: null,
    repo: "",
    copilotkit_version: "",
    backend_url: "",
    deployed: true,
    docs_mode: "authored",
    sort_order: 13,
    features: [],
    demos: [],
  },
];

function allIntegrations(): Integration[] {
  const registeredSlugs = new Set(registry.integrations.map((i) => i.slug));
  return [
    ...registry.integrations,
    ...DOCS_ONLY_INTEGRATIONS.filter((i) => !registeredSlugs.has(i.slug)),
  ];
}

export function getRegistry(): Registry {
  return registry;
}

export function getIntegrations(): Integration[] {
  return allIntegrations();
}

export function getIntegration(slug: string): Integration | undefined {
  return allIntegrations().find((i) => i.slug === slug);
}

/**
 * Frameworks that have no `showcase/integrations/<slug>/` package (and
 * therefore no `manifest.yaml`) but DO have a `frameworkOverviews`
 * entry and/or per-framework docs MDX. These are the "docs-only"
 * frameworks (`a2a`, `agent-spec`, `deepagents`). They never come
 * through the registry, so `docs_mode` resolution falls through to
 * this map. Keep entries here in sync with
 * `showcase/shell-docs/src/data/frameworks/index.ts` if a new docs-
 * only framework is added.
 */
const DOCS_ONLY_FRAMEWORK_MODES: Record<string, "generated" | "authored"> = {
  a2a: "generated",
  "agent-spec": "generated",
  deepagents: "authored",
};

/**
 * Resolve the docs rendering mode for a framework slug. The integration
 * record's `docs_mode` wins; docs-only frameworks fall back to the map
 * above; everything else defaults to `generated` for backwards
 * compatibility with manifests that haven't been updated yet.
 */
export function getDocsMode(slug: string): "generated" | "authored" | "hidden" {
  const integration = getIntegration(slug);
  if (integration?.docs_mode) return integration.docs_mode;
  if (DOCS_ONLY_FRAMEWORK_MODES[slug]) return DOCS_ONLY_FRAMEWORK_MODES[slug];
  return "generated";
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
 * - `microsoft-agent-framework/` serves `ms-agent-dotnet`,
 *   `ms-agent-python`, and `ms-agent-harness-dotnet`, same in-page-tabs
 *   pattern.
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
  "strands-typescript": "aws-strands",
  "ms-agent-dotnet": "microsoft-agent-framework",
  "ms-agent-python": "microsoft-agent-framework",
  "ms-agent-harness-dotnet": "microsoft-agent-framework",
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
  // strands and strands-typescript share the aws-strands/ docs folder, whose
  // pages carry Python/TypeScript language tabs (groupId
  // "language_strands_agent"). Default each framework to its own language so
  // the TS framework opens on the TS snippets (mirrors the langgraph split).
  strands: {
    language_strands_agent: "Python",
  },
  "strands-typescript": {
    language_strands_agent: "TypeScript",
  },
  "ms-agent-dotnet": {
    "language_microsoft-agent-framework_agent": ".NET",
  },
  "ms-agent-python": {
    "language_microsoft-agent-framework_agent": "Python",
  },
  "ms-agent-harness-dotnet": {
    "language_microsoft-agent-framework_agent": ".NET",
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
  for (const integration of getIntegrations()) {
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
  "enterprise-platform": "Intelligence Platform",
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
