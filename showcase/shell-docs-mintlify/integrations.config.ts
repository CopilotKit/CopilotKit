/**
 * Single source of truth for the shell-docs-mintlify information architecture.
 *
 * Edit this file to add an integration, add a universal page, or add an
 * integration-only page. Then run `npm run gen-routing` (or just `npm run dev` —
 * `predev` runs the generator) to regenerate the alias .mdx files and docs.json
 * accordingly. All generated files carry an "AUTO-GENERATED" header.
 */

export interface IntegrationDef {
  slug: string;
  label: string;
  color: string;
  /**
   * Slug of the corresponding package in `showcase/packages/` (used to look up
   * deployed demo URLs for `<ShowcaseDemo>` embeds). Omit if no showcase exists.
   */
  showcaseSlug?: string;
}

export interface PageDef {
  slug: string;
  title: string;
  description?: string;
  /**
   * Sidebar group this page belongs to. Pages with the same group are listed
   * together; groups appear in the order they first occur in `universalPages`.
   * Defaults to "Concepts" if omitted.
   */
  group?: string;
  /**
   * If set, page only appears for these integrations.
   * Mutually exclusive with `except`.
   */
  only?: readonly IntegrationSlug[];
  /**
   * If set, page is hidden for these integrations.
   * Mutually exclusive with `only`.
   */
  except?: readonly IntegrationSlug[];
}

/**
 * Every integration CopilotKit supports, in the order they appear in the
 * sidebar switcher. The first entry is treated as the default/canonical track
 * (its URLs are unprefixed).
 */
export const integrations = [
  {
    slug: "built-in",
    label: "CopilotKit",
    color: "#16A34A",
    showcaseSlug: "built-in-agent",
  },
  {
    slug: "langgraph",
    label: "LangChain",
    color: "#7C3AED",
    showcaseSlug: "langgraph-typescript",
  },
  {
    slug: "adk",
    label: "Google ADK",
    color: "#0EA5E9",
    showcaseSlug: "google-adk",
  },
  { slug: "a2a", label: "A2A (Agent-to-Agent)", color: "#4F46E5" },
  {
    slug: "ag2",
    label: "AG2 (AutoGen)",
    color: "#BE185D",
    showcaseSlug: "ag2",
  },
  { slug: "agent-spec", label: "Agent Spec", color: "#64748B" },
  { slug: "agno", label: "Agno", color: "#14B8A6", showcaseSlug: "agno" },
  {
    slug: "aws-strands",
    label: "AWS Strands",
    color: "#F59E0B",
    showcaseSlug: "strands",
  },
  {
    slug: "crewai-flows",
    label: "CrewAI Flows",
    color: "#DC2626",
    showcaseSlug: "crewai-crews",
  },
  {
    slug: "llamaindex",
    label: "LlamaIndex",
    color: "#0891B2",
    showcaseSlug: "llamaindex",
  },
  { slug: "mastra", label: "Mastra", color: "#F97316", showcaseSlug: "mastra" },
  {
    slug: "microsoft-agent-framework",
    label: "Microsoft Agent Framework",
    color: "#2563EB",
    showcaseSlug: "ms-agent-dotnet",
  },
  {
    slug: "pydantic-ai",
    label: "Pydantic AI",
    color: "#84CC16",
    showcaseSlug: "pydantic-ai",
  },
] as const satisfies readonly IntegrationDef[];

/** Slug of the canonical/default integration. URLs for this one have no prefix. */
export const defaultIntegration = "built-in" as const;

/**
 * Pages whose content is identical (or variant-block-driven) across every
 * integration. Authored once at `docs/<slug>.mdx`. Each non-default integration
 * gets an auto-generated alias at `docs/<integration>/<slug>.mdx`.
 */
export const universalPages = [
  // ─── Get started ───────────────────────────────────────────────
  {
    slug: "quickstart",
    title: "Quickstart",
    description:
      "Get a working copilot running in your app in under five minutes.",
    group: "Get started",
  },

  // ─── Building copilots ─────────────────────────────────────────
  {
    slug: "frontend-tools",
    title: "Frontend tools",
    description:
      "Let the agent control your UI through tools you define in React.",
    group: "Building copilots",
  },
  {
    slug: "server-tools",
    title: "Server tools",
    description: "Define backend tools the agent can invoke.",
    group: "Building copilots",
  },
  {
    slug: "agent-app-context",
    title: "App context",
    description: "Share app-specific context with the agent.",
    group: "Building copilots",
  },
  {
    slug: "shared-state",
    title: "Shared state",
    description: "Bidirectional state sharing between your app and the agent.",
    group: "Building copilots",
  },
  {
    slug: "threads",
    title: "Threads",
    description: "Persist and resume agent conversations across sessions.",
    group: "Building copilots",
  },
  {
    slug: "programmatic-control",
    title: "Programmatic control",
    description:
      "Control the agent programmatically with useAgent and runAgent().",
    group: "Building copilots",
  },
  {
    slug: "chat-suggestions",
    title: "Chat suggestions",
    description:
      "Drive AI-generated or static prompt suggestions in the chat input from your app state.",
    group: "Building copilots",
  },

  // ─── Generative UI ─────────────────────────────────────────────
  {
    slug: "generative-ui",
    title: "Generative UI overview",
    description: "Render rich React components from agent tool calls.",
    group: "Generative UI",
  },
  {
    slug: "generative-ui/tool-rendering",
    title: "Render tool calls",
    description:
      "Visualize an existing tool call with a custom React component.",
    group: "Generative UI",
  },
  {
    slug: "generative-ui/your-components/display-only",
    title: "Components as tools",
    description: "Register a React component as a tool the agent can invoke.",
    group: "Generative UI",
  },
  {
    slug: "generative-ui/your-components/interactive",
    title: "Interactive components",
    description:
      "Render components that ask the user a question and wait for an answer.",
    group: "Generative UI",
  },
  {
    slug: "generative-ui/a2ui",
    title: "Declarative UI (A2UI)",
    description:
      "Let the agent emit UI structure directly — no per-tool React components needed.",
    group: "Generative UI",
  },
  {
    slug: "generative-ui/mcp-apps",
    title: "UI from MCP servers",
    description: "Render UI components emitted by MCP servers.",
    group: "Generative UI",
  },

  // ─── UI customization ──────────────────────────────────────────
  {
    slug: "prebuilt-components",
    title: "Prebuilt components",
    description: "Drop-in chat components.",
    group: "UI customization",
  },
  {
    slug: "custom-look-and-feel/headless-ui",
    title: "Build your own chat UI",
    description: "Roll your own chat UI from scratch with the headless hooks.",
    group: "UI customization",
  },
  {
    slug: "custom-look-and-feel/slots",
    title: "Override chat UI parts",
    description: "Override individual parts of the prebuilt chat UI.",
    group: "UI customization",
  },

  // ─── Models & providers (built-in only) ────────────────────────
  {
    slug: "model-selection",
    title: "Model selection",
    description: "Choose and configure models for the agent.",
    group: "Models & providers",
    only: ["built-in"],
  },
  {
    slug: "custom-agent",
    title: "Bring your own model",
    description: "Bring your own AI SDK, TanStack AI, or custom LLM backend.",
    group: "Models & providers",
    only: ["built-in"],
  },

  // ─── Human-in-the-loop (langgraph + mastra) ────────────────────
  {
    slug: "interrupts",
    title: "Interrupts",
    description: "Pause the agent mid-run and resolve with UI-driven input.",
    group: "Human-in-the-loop",
    only: ["langgraph", "mastra"],
  },

  // ─── Architecture ──────────────────────────────────────────────
  {
    slug: "copilot-runtime",
    title: "Copilot Runtime",
    description: "The backend that connects your frontend to your AI agents.",
    group: "Architecture",
  },
  {
    slug: "ag-ui",
    title: "AG-UI protocol",
    description:
      "The protocol connecting your frontend to the agent via SSE events.",
    group: "Architecture",
  },
  {
    slug: "runtime-frameworks",
    title: "Backend frameworks",
    description:
      "Run the Copilot Runtime on Hono, Express, NestJS, or any Node-compatible backend.",
    group: "Architecture",
  },
  {
    slug: "runtime-middleware",
    title: "Runtime middleware",
    description:
      "Authenticate, log, and modify requests at the runtime level with before/after hooks.",
    group: "Architecture",
    only: ["built-in"],
  },
  {
    slug: "advanced-configuration",
    title: "Advanced configuration",
    description: "Fine-tune the agent's behavior with advanced options.",
    group: "Architecture",
  },
  {
    slug: "inspector",
    title: "CopilotKit Inspector",
    description:
      "Debug actions, readables, agent status, messages, and context.",
    group: "Architecture",
  },

  // ─── Ecosystem ─────────────────────────────────────────────────
  {
    slug: "mcp-servers",
    title: "Connect MCP servers",
    description:
      "Connect MCP servers with persistent clients, tool caching, and dynamic auth.",
    group: "Ecosystem",
  },
  {
    slug: "coding-agents",
    title: "Start with an agent",
    description:
      "Connect Cursor, Claude Code, Windsurf, and other AI coding assistants to CopilotKit's MCP server.",
    group: "Get started",
  },

  // ─── Troubleshooting ───────────────────────────────────────────
  {
    slug: "troubleshooting/common-issues",
    title: "Common issues",
    description: "Frequently-hit issues and their fixes.",
    group: "Troubleshooting",
  },
  {
    slug: "troubleshooting/error-debugging",
    title: "Debugging & observability",
    description: "Debug errors during development and in production.",
    group: "Troubleshooting",
  },
  {
    slug: "troubleshooting/migrate-to-v2",
    title: "Migrate to v2",
    description: "Upgrade an existing CopilotKit app to v2.",
    group: "Troubleshooting",
  },
] as const satisfies readonly PageDef[];

/**
 * Reference pages — API surface docs split into category groups (Hooks,
 * Components, Runtime, Agents, Handlers, Middleware). These are universal
 * across integrations (alias .mdx files are still generated for each prefix)
 * but live under their own "Reference" tab in the Mintlify navigation.
 */
export const referencePages = [
  // Hooks
  {
    slug: "reference/hooks/use-agent",
    title: "useAgent",
    description: "Subscribe to agent state, send messages, manage threads.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-agent-context",
    title: "useAgentContext",
    description: "Share app state with the agent.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-frontend-tool",
    title: "useFrontendTool",
    description: "Define a frontend tool the agent can invoke.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-human-in-the-loop",
    title: "useHumanInTheLoop",
    description: "Pause the agent and request UI input.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-render-tool",
    title: "useRenderTool",
    description: "Render a named tool call as a React component.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-default-render-tool",
    title: "useDefaultRenderTool",
    description: "Catch-all renderer for unknown tools.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-component",
    title: "useComponent",
    description: "Register a React component as a renderable tool.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-interrupt",
    title: "useInterrupt",
    description: "Handle interrupt events from the agent.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-threads",
    title: "useThreads",
    description: "List, create, rename, archive, delete threads.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-attachments",
    title: "useAttachments",
    description: "Manage file attachment state for chat input.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-suggestions",
    title: "useSuggestions",
    description: "Subscribe to AI-generated chat suggestions.",
    group: "Hooks",
  },
  {
    slug: "reference/hooks/use-configure-suggestions",
    title: "useConfigureSuggestions",
    description: "Configure chat suggestions (static or AI-driven).",
    group: "Hooks",
  },
  // Components
  {
    slug: "reference/components/copilot-kit-provider",
    title: "CopilotKit",
    description: "Root provider for the CopilotKit runtime client.",
    group: "Components",
  },
  {
    slug: "reference/components/copilot-chat",
    title: "CopilotChat",
    description: "Inline chat component.",
    group: "Components",
  },
  {
    slug: "reference/components/copilot-popup",
    title: "CopilotPopup",
    description: "Floating chat popup.",
    group: "Components",
  },
  {
    slug: "reference/components/copilot-sidebar",
    title: "CopilotSidebar",
    description: "Slide-in chat sidebar.",
    group: "Components",
  },
  // Runtime
  {
    slug: "reference/runtime/copilot-runtime",
    title: "CopilotRuntime",
    description: "Server-side runtime that orchestrates agent requests.",
    group: "Runtime",
  },
  {
    slug: "reference/runtime/define-tool",
    title: "defineTool",
    description: "Define a server-side tool the agent can invoke.",
    group: "Runtime",
  },
  // Agents
  {
    slug: "reference/agents/built-in-agent",
    title: "BuiltInAgent",
    description: "Direct LLM agent with tools and gen UI.",
    group: "Agents",
  },
  {
    slug: "reference/agents/http-agent",
    title: "HttpAgent",
    description: "Generic AG-UI HTTP agent for connecting external backends.",
    group: "Agents",
  },
  // Handlers
  {
    slug: "reference/handlers/create-copilot-hono-handler",
    title: "createCopilotHonoHandler",
    description: "Hono adapter for the runtime.",
    group: "Handlers",
  },
  {
    slug: "reference/handlers/create-copilot-express-handler",
    title: "createCopilotExpressHandler",
    description: "Express adapter for the runtime.",
    group: "Handlers",
  },
  // Middleware
  {
    slug: "reference/middleware/before-request-middleware",
    title: "beforeRequestMiddleware",
    description: "Pre-request hook for auth, modification, or short-circuit.",
    group: "Middleware",
  },
  {
    slug: "reference/middleware/after-request-middleware",
    title: "afterRequestMiddleware",
    description: "Post-request hook for logging and audit.",
    group: "Middleware",
  },
  {
    slug: "reference/middleware/open-generative-ui-middleware",
    title: "OpenGenerativeUIMiddleware",
    description: "Auto-rendered generative UI from LLM output.",
    group: "Middleware",
  },
  {
    slug: "reference/middleware/a2ui-middleware",
    title: "A2UIMiddleware",
    description: "Declarative UI streaming middleware.",
    group: "Middleware",
  },
  {
    slug: "reference/middleware/mcp-apps-middleware",
    title: "MCPAppsMiddleware",
    description: "UI-enabled MCP server middleware.",
    group: "Middleware",
  },
] as const satisfies readonly PageDef[];

/**
 * Pages that only exist for specific integrations (e.g., LangGraph subgraphs).
 * Author the content yourself at `docs/<integration>/<slug>.mdx`. The generator
 * doesn't touch these files — it only reads the metadata to populate docs.json.
 */
export const integrationOnlyPages = {
  langgraph: [
    { slug: "human-in-the-loop", title: "Human in the Loop" },
    { slug: "subgraphs", title: "Subgraphs" },
    { slug: "multi-agent-flows", title: "Multi-Agent Flows" },
  ],
  "aws-strands": [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
  a2a: [{ slug: "declarative-a2ui", title: "Declarative A2UI" }],
  ag2: [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
  "agent-spec": [{ slug: "langgraph", title: "LangChain adapter" }],
  agno: [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
  "crewai-flows": [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
  llamaindex: [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
  "microsoft-agent-framework": [
    { slug: "human-in-the-loop", title: "Human in the Loop" },
  ],
  "pydantic-ai": [{ slug: "human-in-the-loop", title: "Human in the Loop" }],
} as const satisfies Record<string, readonly PageDef[]>;

// Derived helpers (don't edit by hand)
export type IntegrationSlug = (typeof integrations)[number]["slug"];
export type UniversalPageSlug = (typeof universalPages)[number]["slug"];
export type ReferencePageSlug = (typeof referencePages)[number]["slug"];

/**
 * Returns the set of integration slugs a page should be aliased for, based on
 * its `only` / `except` gating fields. If neither is set, all integrations are
 * supported. `only` and `except` are mutually exclusive — if both are set,
 * `only` wins (and a warning would be appropriate at validation time).
 */
export function getSupportedIntegrations(
  page: PageDef,
): readonly IntegrationSlug[] {
  const all = integrations.map((i) => i.slug) as readonly IntegrationSlug[];
  if (page.only && page.only.length > 0) {
    const allowed = new Set<string>(page.only);
    return all.filter((s) => allowed.has(s));
  }
  if (page.except && page.except.length > 0) {
    const blocked = new Set<string>(page.except);
    return all.filter((s) => !blocked.has(s));
  }
  return all;
}

/**
 * True when `built-in` (the default/canonical integration) is in the page's
 * support set. Used to decide whether the canonical (unprefixed) URL slug
 * should be emitted in the sidebar at all.
 */
export function isCanonicalSupported(page: PageDef): boolean {
  return getSupportedIntegrations(page).includes(defaultIntegration);
}
