/**
 * INTENTIONAL COPY of `showcase/shell/src/lib/seo-redirects.ts`.
 *
 * The showcase-ops runtime image is built hermetic from showcase-ops's
 * own src/ tree; the shell package's src/ is not COPYd into the runtime
 * stage. Earlier versions of the redirect-decommission driver
 * dynamic-imported this file through the `../../../../shell/src/lib/`
 * backchannel so tsc would not follow the path, which caused a runtime
 * ENOENT on every container tick. Inlining here removes the need for a
 * runtime path into the shell tree.
 *
 * Source of truth for middleware + validate-redirects stays at the
 * original location in `showcase/shell/src/lib/seo-redirects.ts`. Both
 * copies MUST stay in sync — any add/remove in the shell copy must be
 * mirrored here, or the redirect-decommission report will surface
 * phantom candidates (ID present in shell, missing here → reported as
 * zero-hit in the ops report).
 *
 * SEO Redirect Definitions — Single Source of Truth
 *
 * Consumed by:
 *   - middleware.ts (matches requests, fires PostHog event, issues 301)
 *   - validate-redirects.ts (verifies 301s + destinations)
 *   - redirect-decommission-report.ts (cross-references PostHog traffic)
 *
 * Spec & Inventory: https://www.notion.so/33c3aa38185281d7b243c5cf0a7c14cb
 */

export interface RedirectEntry {
  /** Spec ID (e.g., "L3", "S4×agno", "P1×langgraph") for cross-referencing Notion inventory */
  id: string;
  /** Source path pattern. Use :path* for wildcard suffix matching. */
  source: string;
  /** Destination path on the showcase. Use :path* to carry over the wildcard. */
  destination: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FRAMEWORKS = [
  "langgraph",
  "adk",
  "agno",
  "crewai-flows",
  "pydantic-ai",
  "llamaindex",
  "mastra",
  "agent-spec",
  "ag2",
  "microsoft-agent-framework",
  "aws-strands",
  "a2a",
  "unselected",
] as const;

/** Per-framework subpath renames (Category 5 in spec). Applied to ALL 13 frameworks. */
const SUBPATH_RENAMES: { specId: string; from: string; to: string }[] = [
  { specId: "S1", from: "agentic-chat-ui", to: "prebuilt-components" },
  { specId: "S2", from: "use-agent-hook", to: "programmatic-control" },
  { specId: "S3", from: "frontend-actions", to: "frontend-tools" },
  { specId: "S4", from: "vibe-coding-mcp", to: "coding-agents" },
  {
    specId: "S5",
    from: "generative-ui/agentic",
    to: "generative-ui/your-components/display-only",
  },
  {
    specId: "S6",
    from: "generative-ui/backend-tools",
    to: "generative-ui/tool-rendering",
  },
  { specId: "S7", from: "generative-ui/frontend-tools", to: "frontend-tools" },
  {
    specId: "S8",
    from: "generative-ui/render-only",
    to: "generative-ui/your-components/display-only",
  },
  {
    specId: "S9",
    from: "generative-ui/tool-based",
    to: "generative-ui/tool-rendering",
  },
  {
    specId: "S10",
    from: "custom-look-and-feel/bring-your-own-components",
    to: "custom-look-and-feel/slots",
  },
  {
    specId: "S11",
    from: "custom-look-and-feel/customize-built-in-ui-components",
    to: "custom-look-and-feel/slots",
  },
  {
    specId: "S12",
    from: "custom-look-and-feel/markdown-rendering",
    to: "custom-look-and-feel/slots",
  },
  { specId: "S14", from: "guide", to: "guides" },
  { specId: "S15", from: "mcp", to: "coding-agents" },
];

// S13 (concepts/:path* -> framework root) handled separately since it's a wildcard-to-single-page

// ---------------------------------------------------------------------------
// Generated: Per-framework subpath renames (Category 5)
// Each SUBPATH_RENAME × each FRAMEWORK = one redirect entry
// ---------------------------------------------------------------------------

function generateFrameworkRenames(): RedirectEntry[] {
  const entries: RedirectEntry[] = [];
  for (const fw of FRAMEWORKS) {
    // S13: concepts/* collapses to framework root
    entries.push({
      id: `S13w×${fw}`,
      source: `/${fw}/concepts/:path*`,
      destination: `/docs/integrations/${fw}`,
    });
    entries.push({
      id: `S13e×${fw}`,
      source: `/${fw}/concepts`,
      destination: `/docs/integrations/${fw}`,
    });

    for (const rename of SUBPATH_RENAMES) {
      entries.push({
        id: `${rename.specId}×${fw}`,
        source: `/${fw}/${rename.from}`,
        destination: `/docs/integrations/${fw}/${rename.to}`,
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Category 3: Deep Coagents Redirects (specific paths)
// ---------------------------------------------------------------------------

const DEEP_COAGENTS: RedirectEntry[] = [
  {
    id: "D1",
    source: "/coagents/tutorials/ai-travel-app/overview",
    destination: "/docs/integrations/langgraph/tutorials/ai-travel-app",
  },
  {
    id: "D2",
    source: "/coagents/chat-ui/hitl/json-hitl",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D3",
    source: "/coagents/react-ui/frontend-functions",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D4",
    source: "/coagents/chat-ui/render-agent-state",
    destination:
      "/docs/integrations/langgraph/generative-ui/your-components/display-only",
  },
  {
    id: "D5",
    source: "/coagents/chat-ui/hitl",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D6",
    source: "/coagents/chat-ui/hitl/interrupt-flow",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D7",
    source: "/coagents/chat-ui/loading-message-history",
    destination:
      "/docs/integrations/langgraph/advanced/persistence/loading-message-history",
  },
  {
    id: "D8",
    source: "/coagents/react-ui/in-app-agent-read",
    destination: "/docs/integrations/langgraph/shared-state/in-app-agent-read",
  },
  {
    id: "D9",
    source: "/coagents/react-ui/in-app-agent-write",
    destination: "/docs/integrations/langgraph/shared-state/in-app-agent-write",
  },
  {
    id: "D10",
    source: "/coagents/react-ui/hitl",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D11",
    source: "/coagents/advanced/router-mode-agent-lock",
    destination: "/docs/integrations/langgraph",
  },
  {
    id: "D12",
    source: "/coagents/advanced/intermediate-state-streaming",
    destination:
      "/docs/integrations/langgraph/shared-state/predictive-state-updates",
  },
  {
    id: "D13",
    source: "/coagents/shared-state/intermediate-state-streaming",
    destination:
      "/docs/integrations/langgraph/shared-state/predictive-state-updates",
  },
  {
    id: "D14",
    source: "/coagents/advanced/manually-emitting-messages",
    destination: "/docs/integrations/langgraph/advanced/emit-messages",
  },
  {
    id: "D15",
    source: "/coagents/advanced/copilotkit-state",
    destination: "/docs/integrations/langgraph/frontend-tools",
  },
  {
    id: "D16",
    source: "/coagents/advanced/message-persistence",
    destination:
      "/docs/integrations/langgraph/advanced/persistence/message-persistence",
  },
  {
    id: "D17",
    source: "/coagents/advanced/loading-message-history",
    destination:
      "/docs/integrations/langgraph/advanced/persistence/loading-message-history",
  },
  {
    id: "D18",
    source: "/coagents/advanced/loading-agent-state",
    destination:
      "/docs/integrations/langgraph/advanced/persistence/loading-agent-state",
  },
  {
    id: "D19",
    source: "/coagents/advanced/state-streaming",
    destination: "/docs/integrations/langgraph/shared-state",
  },
  {
    id: "D20",
    source: "/coagents/concepts/state",
    destination: "/docs/integrations/langgraph/shared-state",
  },
  {
    id: "D21",
    source: "/coagents/concepts/human-in-the-loop",
    destination: "/docs/integrations/langgraph/human-in-the-loop",
  },
  {
    id: "D22",
    source: "/coagents/concepts/multi-agent-flows",
    destination: "/docs/integrations/langgraph",
  },
  {
    id: "D23",
    source: "/coagents/quickstart/langgraph",
    destination: "/docs/integrations/langgraph/quickstart",
  },
  {
    id: "D24",
    source: "/coagents/shared-state/state-inputs-outputs",
    destination: "/docs/integrations/langgraph/shared-state/workflow-execution",
  },
];

// ---------------------------------------------------------------------------
// Category 6: Specific Framework Redirects (one-off path combinations)
// ---------------------------------------------------------------------------

const SPECIFIC_FRAMEWORK: RedirectEntry[] = [
  {
    id: "F1",
    source: "/langgraph/quickstart/langgraph",
    destination: "/docs/integrations/langgraph/quickstart",
  },
  {
    id: "F2",
    source: "/crewai-flows/quickstart/crewai",
    destination: "/docs/integrations/crewai-flows/quickstart",
  },
  {
    id: "F3",
    source: "/mastra/quickstart/mastra",
    destination: "/docs/integrations/mastra/quickstart",
  },
  {
    id: "F4",
    source: "/ag2/quickstart/ag2",
    destination: "/docs/integrations/ag2/quickstart",
  },
  {
    id: "F5",
    source: "/agno/quickstart/agno",
    destination: "/docs/integrations/agno/quickstart",
  },
  {
    id: "F6",
    source: "/pydantic-ai/quickstart/pydantic-ai",
    destination: "/docs/integrations/pydantic-ai/quickstart",
  },
  {
    id: "F7",
    source: "/adk/quickstart/adk",
    destination: "/docs/integrations/adk/quickstart",
  },
  {
    id: "F8",
    source: "/langgraph/generative-ui/display",
    destination:
      "/docs/integrations/langgraph/generative-ui/your-components/display-only",
  },
  {
    id: "F9",
    source: "/langgraph/generative-ui/interactive/interrupt-based",
    destination:
      "/docs/integrations/langgraph/generative-ui/your-components/interrupt-based",
  },
  {
    id: "F10",
    source: "/langgraph/generative-ui/interactive/client-side",
    destination:
      "/docs/integrations/langgraph/generative-ui/your-components/interactive",
  },
  {
    id: "F11",
    source: "/langgraph/human-in-the-loop/node-flow",
    destination:
      "/docs/integrations/langgraph/human-in-the-loop/interrupt-flow",
  },
  {
    id: "F12",
    source: "/langgraph/human-in-the-loop/prebuilt-agents",
    destination: "/docs/integrations/langgraph/prebuilt-components",
  },
  {
    id: "F13",
    source: "/aws-strands/human-in-the-loop",
    destination: "/docs/human-in-the-loop",
  },
  {
    id: "F14",
    source: "/adk/shared-state/state-inputs-outputs",
    destination: "/docs/integrations/adk/shared-state/workflow-execution",
  },
  {
    id: "F15",
    source: "/langgraph/shared-state/state-inputs-outputs",
    destination: "/docs/integrations/langgraph/shared-state/workflow-execution",
  },
  {
    id: "F16",
    source: "/llamaindex/shared-state/state-inputs-outputs",
    destination:
      "/docs/integrations/llamaindex/shared-state/workflow-execution",
  },
  {
    id: "F20",
    source: "/direct-to-llm/guides/mcp",
    destination: "/docs/unselected/coding-agents",
  },
];

// ---------------------------------------------------------------------------
// Category 4: Root-Level Renames & Moves
// ---------------------------------------------------------------------------

const ROOT_RENAMES: RedirectEntry[] = [
  { id: "R1", source: "/api", destination: "/reference" },
  { id: "R2", source: "/docs/api", destination: "/reference" },
  { id: "R3", source: "/api-reference", destination: "/reference" },
  { id: "R4", source: "/getting-started", destination: "/docs/quickstart" },
  { id: "R5", source: "/start", destination: "/docs/quickstart" },
  {
    id: "R6",
    source: "/frontend-actions",
    destination: "/docs/frontend-tools",
  },
  {
    id: "R7",
    source: "/generative-ui",
    destination: "/docs/generative-ui/your-components/display-only",
  },
  {
    id: "R8",
    source: "/generative-ui/display",
    destination: "/docs/generative-ui/your-components/display-only",
  },
  {
    id: "R9",
    source: "/generative-ui/interactive",
    destination: "/docs/generative-ui/your-components/interactive",
  },
  {
    id: "R10",
    source: "/agentic-chat-ui",
    destination: "/docs/prebuilt-components",
  },
  {
    id: "R11",
    source: "/headless",
    destination: "/docs/custom-look-and-feel/headless-ui",
  },
  {
    id: "R12",
    source: "/coding-agent-setup",
    destination: "/docs/coding-agents",
  },
  {
    id: "R13",
    source: "/copilot-suggestions",
    destination: "/docs/prebuilt-components",
  },
  { id: "R14", source: "/direct-to-llm", destination: "/docs/unselected" },
  { id: "R15", source: "/builtin-agent", destination: "/docs/unselected" },
  { id: "R18", source: "/mcp", destination: "/docs/coding-agents" },
  { id: "R19", source: "/vibe-coding-mcp", destination: "/docs/coding-agents" },
  {
    id: "R20",
    source: "/agentic-protocols",
    destination: "/docs/learn/agentic-protocols",
  },
  {
    id: "R21",
    source: "/ag-ui-protocol",
    destination: "/docs/learn/ag-ui-protocol",
  },
  {
    id: "R22",
    source: "/connect-mcp-servers",
    destination: "/docs/learn/connect-mcp-servers",
  },
  {
    id: "R23",
    source: "/a2a-protocol",
    destination: "/docs/learn/a2a-protocol",
  },
  {
    id: "R24",
    source: "/architecture",
    destination: "/docs/learn/architecture",
  },
  {
    id: "R25",
    source: "/runtime-server-adapter",
    destination: "/docs/backend/copilot-runtime",
  },
  {
    id: "R27",
    source: "/whats-new/v1-50",
    destination: "/docs/learn/whats-new/v1-50",
  },
  // Manual overrides (Category 7) — root-level doc pages
  { id: "M2", source: "/quickstart", destination: "/docs/quickstart" },
  { id: "M3", source: "/faq", destination: "/docs/faq" },
  { id: "M4", source: "/frontend-tools", destination: "/docs/frontend-tools" },
  {
    id: "M5",
    source: "/human-in-the-loop",
    destination: "/docs/human-in-the-loop",
  },
  {
    id: "M6",
    source: "/prebuilt-components",
    destination: "/docs/prebuilt-components",
  },
  { id: "M7", source: "/coding-agents", destination: "/docs/coding-agents" },
  { id: "M8", source: "/telemetry", destination: "/docs/telemetry" },
  // Broken link fixes (B1-B3)
  {
    id: "B1",
    source: "/guides/custom-look-and-feel/bring-your-own-components",
    destination: "/docs/custom-look-and-feel/slots",
  },
  {
    id: "B2",
    source: "/guides/self-hosting",
    destination: "/docs/backend/copilot-runtime",
  },
  {
    id: "B3",
    source: "/guides/backend-actions/remote-backend-endpoint",
    destination: "/docs/backend/copilot-runtime",
  },
];

// ---------------------------------------------------------------------------
// Category 2: Legacy Redirect Chains (coagents -> langgraph, crewai-crews -> crewai-flows)
// Specific entries BEFORE the catch-all wildcards
// ---------------------------------------------------------------------------

const LEGACY_CHAINS_EXACT: RedirectEntry[] = [
  {
    id: "L1",
    source: "/coagents",
    destination: "/docs/integrations/langgraph",
  },
  {
    id: "L2",
    source: "/coagents/quickstart",
    destination: "/docs/integrations/langgraph/quickstart",
  },
  {
    id: "L3",
    source: "/coagents/frontend-actions",
    destination: "/docs/integrations/langgraph/frontend-tools",
  },
  {
    id: "L4",
    source: "/coagents/generative-ui",
    destination: "/docs/integrations/langgraph/generative-ui",
  },
  {
    id: "L5",
    source: "/coagents/human-in-the-loop",
    destination: "/docs/integrations/langgraph/human-in-the-loop",
  },
  {
    id: "L6",
    source: "/coagents/multi-agent-flows",
    destination: "/docs/integrations/langgraph/multi-agent-flows",
  },
  {
    id: "L7",
    source: "/coagents/persistence",
    destination: "/docs/integrations/langgraph/advanced/persistence",
  },
  {
    id: "L8",
    source: "/coagents/shared-state",
    destination: "/docs/integrations/langgraph/shared-state",
  },
  {
    id: "L9",
    source: "/coagents/concepts",
    destination: "/docs/integrations/langgraph",
  },
  {
    id: "L10",
    source: "/coagents/tutorials",
    destination: "/docs/integrations/langgraph/tutorials",
  },
  {
    id: "L11",
    source: "/coagents/videos",
    destination: "/docs/integrations/langgraph/videos",
  },
  {
    id: "L14",
    source: "/crewai-crews",
    destination: "/docs/integrations/crewai-flows",
  },
];

// ---------------------------------------------------------------------------
// Wildcard redirects (legacy chains + pattern rules)
// These MUST come LAST — they are catch-alls
// ---------------------------------------------------------------------------

const WILDCARD_REDIRECTS: RedirectEntry[] = [
  // Category 2 wildcards
  {
    id: "L12",
    source: "/coagents/:path*",
    destination: "/docs/integrations/langgraph/:path*",
  },
  {
    id: "L13",
    source: "/crewai-crews/:path*",
    destination: "/docs/integrations/crewai-flows/:path*",
  },
  // Category 4 wildcards
  {
    id: "R16",
    source: "/direct-to-llm/:path*",
    destination: "/docs/unselected/:path*",
  },
  {
    id: "R17",
    source: "/builtin-agent/:path*",
    destination: "/docs/unselected/:path*",
  },
  { id: "R26", source: "/shared/:path*", destination: "/docs/:path*" },
  // Category 6 wildcards
  {
    id: "F17",
    source: "/generative-ui/direct-to-llm/:path*",
    destination: "/docs/unselected/:path*",
  },
  {
    id: "F18",
    source: "/generative-ui/langgraph/:path*",
    destination: "/docs/integrations/langgraph/:path*",
  },
  {
    id: "F19",
    source: "/generative-ui-specs/:path*",
    destination: "/docs/generative-ui/specs/:path*",
  },
  // Category 1: Pattern rules (bulk coverage)
  {
    id: "P9",
    source: "/reference/v2/:path*",
    destination: "/reference/:path*",
  },
  { id: "P10", source: "/reference/v1/:path*", destination: "/reference" },
  {
    id: "P11",
    source: "/guides/:path*",
    destination: "/docs/unselected/guides/:path*",
  },
  { id: "P12", source: "/backend/:path*", destination: "/docs/backend/:path*" },
  { id: "P3", source: "/learn/:path*", destination: "/docs/learn/:path*" },
  {
    id: "P4",
    source: "/troubleshooting/:path*",
    destination: "/docs/troubleshooting/:path*",
  },
  {
    id: "P5",
    source: "/custom-look-and-feel/:path*",
    destination: "/docs/custom-look-and-feel/:path*",
  },
  {
    id: "P6",
    source: "/generative-ui/:path*",
    destination: "/docs/generative-ui/:path*",
  },
  { id: "P7", source: "/premium/:path*", destination: "/docs/premium/:path*" },
  {
    id: "P8",
    source: "/contributing/:path*",
    destination: "/docs/contributing/:path*",
  },
  // P1 + P2: Per-framework catch-alls (MUST be last — they match any /{framework}/*)
  ...FRAMEWORKS.map((fw) => ({
    id: `P1×${fw}`,
    source: `/${fw}/:path*`,
    destination: `/docs/integrations/${fw}/:path*`,
  })),
  ...FRAMEWORKS.map((fw) => ({
    id: `P2×${fw}`,
    source: `/${fw}`,
    destination: `/docs/integrations/${fw}`,
  })),
];

// ---------------------------------------------------------------------------
// Combined export — ordered most-specific to least-specific
// Middleware evaluates top-to-bottom, first match wins
// ---------------------------------------------------------------------------

export const seoRedirects: RedirectEntry[] = [
  // 1. Most-specific exact paths first
  ...DEEP_COAGENTS,
  ...SPECIFIC_FRAMEWORK,
  ...ROOT_RENAMES,
  ...LEGACY_CHAINS_EXACT,
  // 2. Generated per-framework subpath renames (exact paths)
  ...generateFrameworkRenames(),
  // 3. Wildcard catch-alls last
  ...WILDCARD_REDIRECTS,
];
