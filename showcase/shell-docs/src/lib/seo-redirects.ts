/**
 * SEO Redirect Definitions — Single Source of Truth
 *
 * Consumed by:
 *   - middleware.ts (matches requests, fires PostHog event, issues 301)
 *   - validate-redirects.ts (verifies 301s + destinations)
 *   - redirect-decommission-report.ts (cross-references PostHog traffic)
 *
 * Destinations target the shell-docs routing surface, which serves at
 * the host root (no `/docs/` prefix) and uses the registry framework
 * slugs (e.g. `langgraph-python`, `google-adk`, `strands`,
 * `ms-agent-dotnet`, `crewai-crews`, `built-in-agent`). Legacy upstream
 * URLs that used the old slugs (`langgraph`, `adk`, `aws-strands`,
 * `microsoft-agent-framework`, `crewai-flows`, `unselected`) are
 * rewritten here so the historic SEO surface keeps redirecting cleanly
 * to the new canonical homes.
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

// Historical framework slugs that appear in legacy upstream URLs.
// These are the slugs the SEO surface SAW pre-cutover — destinations are
// remapped via SLUG_RENAMES below to the canonical shell-docs slugs.
const FRAMEWORKS = [
  "langgraph",
  "adk",
  "agno",
  "crewai-flows",
  "pydantic-ai",
  "llamaindex",
  "mastra",
  "deepagents",
  "agent-spec",
  "ag2",
  "microsoft-agent-framework",
  "aws-strands",
  "a2a",
  "unselected",
] as const;

/**
 * Map from legacy framework slug → canonical shell-docs slug.
 * Slugs not listed here keep the same value in destinations.
 */
const SLUG_RENAMES: Record<string, string> = {
  langgraph: "langgraph-python",
  adk: "google-adk",
  "aws-strands": "strands",
  "microsoft-agent-framework": "ms-agent-dotnet",
  "crewai-flows": "crewai-crews",
  unselected: "built-in-agent",
};

/** Resolve a legacy framework slug to its canonical shell-docs slug. */
function canonicalSlug(legacy: string): string {
  return SLUG_RENAMES[legacy] ?? legacy;
}

function destinationPrefix(canonicalFramework: string): string {
  return canonicalFramework === "built-in-agent"
    ? ""
    : `/${canonicalFramework}`;
}

function destinationPath(canonicalFramework: string, pathSuffix = ""): string {
  const prefix = destinationPrefix(canonicalFramework);
  if (!pathSuffix) return prefix || "/";
  return `${prefix}/${pathSuffix}`;
}

/**
 * Canonical (post-cutover) framework slugs served by shell-docs. Used for
 * wildcard rules that match the current URL surface rather than legacy
 * upstream slugs. Keep in sync with the registry; covers generated,
 * authored, and hidden buckets.
 */
const CANONICAL_FRAMEWORKS = [
  "built-in-agent",
  "langgraph-python",
  "langgraph-typescript",
  "langgraph-fastapi",
  "google-adk",
  "a2a",
  "agent-spec",
  "deepagents",
  "mastra",
  "crewai-crews",
  "pydantic-ai",
  "agno",
  "ag2",
  "llamaindex",
  "strands",
  "strands-typescript",
  "ms-agent-python",
  "ms-agent-dotnet",
  "claude-sdk-python",
  "claude-sdk-typescript",
  "langroid",
  "spring-ai",
] as const;

/** Per-framework subpath renames (Category 5 in spec). Applied to ALL 13 frameworks. */
const SUBPATH_RENAMES: { specId: string; from: string; to: string }[] = [
  { specId: "S1", from: "agentic-chat-ui", to: "prebuilt-components" },
  { specId: "S2", from: "use-agent-hook", to: "programmatic-control" },
  { specId: "S3", from: "frontend-actions", to: "frontend-tools" },
  { specId: "S4", from: "vibe-coding-mcp", to: "build-with-agents" },
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
  { specId: "S15", from: "mcp", to: "build-with-agents" },
  { specId: "S16", from: "coding-agents", to: "build-with-agents" },
];

// S13 (concepts/:path* -> framework root) handled separately since it's a wildcard-to-single-page

// ---------------------------------------------------------------------------
// Generated: Per-framework subpath renames (Category 5)
// Each SUBPATH_RENAME × each FRAMEWORK = one redirect entry
// ---------------------------------------------------------------------------

function generateFrameworkRenames(): RedirectEntry[] {
  const entries: RedirectEntry[] = [];
  for (const fw of FRAMEWORKS) {
    const fwDest = canonicalSlug(fw);
    // S13: concepts/* collapses to framework root.
    //
    // Originally added to retire legacy `/langgraph/concepts/*` URLs
    // (LangGraph had authored concept pages pre-cutover that the
    // shell-docs IA removed). Only emit this when the framework slug
    // actually renamed (legacy ≠ canonical) — for canonical-slug
    // frameworks (`mastra`, `ag2`, `agno`, etc.) the legacy docs never
    // had `/<fw>/concepts/*` pages, AND shell-docs now serves the
    // agnostic `/concepts/*` content under every framework's scope
    // (e.g. `/mastra/concepts/architecture`). Leaving the unconditional
    // rule in place would 301 those valid agnostic-content URLs away.
    if (fw !== fwDest) {
      entries.push({
        id: `S13w×${fw}`,
        source: `/${fw}/concepts/:path*`,
        destination: destinationPath(fwDest),
      });
      entries.push({
        id: `S13e×${fw}`,
        source: `/${fw}/concepts`,
        destination: destinationPath(fwDest),
      });
    }

    for (const rename of SUBPATH_RENAMES) {
      entries.push({
        id: `${rename.specId}×${fw}`,
        source: `/${fw}/${rename.from}`,
        destination: destinationPath(fwDest, rename.to),
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// /coding-agents renamed to /build-with-agents
// Covers the root page + all canonical framework slugs (exact 301s).
// S16 in SUBPATH_RENAMES handles the legacy-slug surface; these entries
// handle the canonical-slug surface (e.g. /langgraph-python/coding-agents).
// ---------------------------------------------------------------------------

const CODING_AGENTS_RENAMES: RedirectEntry[] = [
  {
    id: "CA-root",
    source: "/coding-agents",
    destination: "/build-with-agents",
  },
  ...[...new Set(FRAMEWORKS.map(canonicalSlug))].map((fw) => ({
    id: `CA×${fw}`,
    source: `/${fw}/coding-agents`,
    destination: destinationPath(fw, "build-with-agents"),
  })),
];

// ---------------------------------------------------------------------------
// Category 3: Deep Coagents Redirects (specific paths)
// ---------------------------------------------------------------------------

const DEEP_COAGENTS: RedirectEntry[] = [
  {
    id: "D1",
    source: "/coagents/tutorials/ai-travel-app/overview",
    destination: "/langgraph-python/tutorials/ai-travel-app",
  },
  {
    id: "D2",
    source: "/coagents/chat-ui/hitl/json-hitl",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D3",
    source: "/coagents/react-ui/frontend-functions",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D4",
    source: "/coagents/chat-ui/render-agent-state",
    destination: "/langgraph-python/generative-ui/your-components/display-only",
  },
  {
    id: "D5",
    source: "/coagents/chat-ui/hitl",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D6",
    source: "/coagents/chat-ui/hitl/interrupt-flow",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D7",
    source: "/coagents/chat-ui/loading-message-history",
    destination:
      "/langgraph-python/advanced/persistence/loading-message-history",
  },
  {
    id: "D8",
    source: "/coagents/react-ui/in-app-agent-read",
    destination: "/langgraph-python/shared-state/in-app-agent-read",
  },
  {
    id: "D9",
    source: "/coagents/react-ui/in-app-agent-write",
    destination: "/langgraph-python/shared-state/in-app-agent-write",
  },
  {
    id: "D10",
    source: "/coagents/react-ui/hitl",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "D11",
    source: "/coagents/advanced/router-mode-agent-lock",
    destination: "/langgraph-python",
  },
  {
    id: "D12",
    source: "/coagents/advanced/intermediate-state-streaming",
    destination: "/langgraph-python/shared-state/predictive-state-updates",
  },
  {
    id: "D13",
    source: "/coagents/shared-state/intermediate-state-streaming",
    destination: "/langgraph-python/shared-state/predictive-state-updates",
  },
  {
    id: "D14",
    source: "/coagents/advanced/manually-emitting-messages",
    destination: "/langgraph-python/advanced/emit-messages",
  },
  {
    id: "D15",
    source: "/coagents/advanced/copilotkit-state",
    destination: "/langgraph-python/frontend-tools",
  },
  {
    id: "D16",
    source: "/coagents/advanced/message-persistence",
    destination: "/langgraph-python/advanced/persistence/message-persistence",
  },
  {
    id: "D17",
    source: "/coagents/advanced/loading-message-history",
    destination:
      "/langgraph-python/advanced/persistence/loading-message-history",
  },
  {
    id: "D18",
    source: "/coagents/advanced/loading-agent-state",
    destination: "/langgraph-python/advanced/persistence/loading-agent-state",
  },
  {
    id: "D19",
    source: "/coagents/advanced/state-streaming",
    destination: "/langgraph-python/shared-state",
  },
  {
    id: "D20",
    source: "/coagents/concepts/state",
    destination: "/langgraph-python/shared-state",
  },
  {
    id: "D21",
    source: "/coagents/concepts/human-in-the-loop",
    destination: "/langgraph-python/human-in-the-loop",
  },
  {
    id: "D22",
    source: "/coagents/concepts/multi-agent-flows",
    destination: "/langgraph-python",
  },
  {
    id: "D23",
    source: "/coagents/quickstart/langgraph",
    destination: "/langgraph-python/quickstart",
  },
  {
    id: "D24",
    source: "/coagents/shared-state/state-inputs-outputs",
    destination: "/langgraph-python/shared-state/workflow-execution",
  },
];

// ---------------------------------------------------------------------------
// Category 6: Specific Framework Redirects (one-off path combinations)
// ---------------------------------------------------------------------------

const SPECIFIC_FRAMEWORK: RedirectEntry[] = [
  {
    id: "F1",
    source: "/langgraph/quickstart/langgraph",
    destination: "/langgraph-python/quickstart",
  },
  {
    id: "F2",
    source: "/crewai-flows/quickstart/crewai",
    destination: "/crewai-crews/quickstart",
  },
  {
    id: "F3",
    source: "/mastra/quickstart/mastra",
    destination: "/mastra/quickstart",
  },
  {
    id: "F4",
    source: "/ag2/quickstart/ag2",
    destination: "/ag2/quickstart",
  },
  {
    id: "F5",
    source: "/agno/quickstart/agno",
    destination: "/agno/quickstart",
  },
  {
    id: "F6",
    source: "/pydantic-ai/quickstart/pydantic-ai",
    destination: "/pydantic-ai/quickstart",
  },
  {
    id: "F7",
    source: "/adk/quickstart/adk",
    destination: "/google-adk/quickstart",
  },
  {
    id: "F8",
    source: "/langgraph/generative-ui/display",
    destination: "/langgraph-python/generative-ui/your-components/display-only",
  },
  {
    id: "F9",
    source: "/langgraph/generative-ui/interactive/interrupt-based",
    destination:
      "/langgraph-python/generative-ui/your-components/interrupt-based",
  },
  {
    id: "F10",
    source: "/langgraph/generative-ui/interactive/client-side",
    destination: "/langgraph-python/generative-ui/your-components/interactive",
  },
  {
    id: "F11",
    source: "/langgraph/human-in-the-loop/node-flow",
    destination: "/langgraph-python/human-in-the-loop/interrupt-flow",
  },
  {
    id: "F12",
    source: "/langgraph/human-in-the-loop/prebuilt-agents",
    destination: "/langgraph-python/prebuilt-components",
  },
  {
    id: "F13",
    source: "/aws-strands/human-in-the-loop",
    destination: "/human-in-the-loop",
  },
  {
    id: "F14",
    source: "/adk/shared-state/state-inputs-outputs",
    destination: "/google-adk/shared-state/workflow-execution",
  },
  {
    id: "F15",
    source: "/langgraph/shared-state/state-inputs-outputs",
    destination: "/langgraph-python/shared-state/workflow-execution",
  },
  {
    id: "F16",
    source: "/llamaindex/shared-state/state-inputs-outputs",
    destination: "/llamaindex/shared-state/workflow-execution",
  },
  {
    id: "F20",
    source: "/direct-to-llm/guides/mcp",
    destination: "/build-with-agents",
  },
];

// ---------------------------------------------------------------------------
// Category 4: Root-Level Renames & Moves
// ---------------------------------------------------------------------------

const ROOT_RENAMES: RedirectEntry[] = [
  { id: "R1", source: "/api", destination: "/reference/v2" },
  { id: "R2", source: "/docs/api", destination: "/reference/v2" },
  { id: "R3", source: "/api-reference", destination: "/reference/v2" },
  { id: "R4", source: "/getting-started", destination: "/" },
  { id: "R5", source: "/start", destination: "/" },
  {
    id: "R6",
    source: "/frontend-actions",
    destination: "/frontend-tools",
  },
  {
    id: "R7",
    source: "/generative-ui",
    destination: "/generative-ui/your-components/display-only",
  },
  {
    id: "R8",
    source: "/generative-ui/display",
    destination: "/generative-ui/your-components/display-only",
  },
  {
    id: "R9",
    source: "/generative-ui/interactive",
    destination: "/generative-ui/your-components/interactive",
  },
  {
    id: "R10",
    source: "/agentic-chat-ui",
    destination: "/prebuilt-components",
  },
  {
    id: "R11",
    source: "/headless",
    destination: "/custom-look-and-feel/headless-ui",
  },
  {
    id: "R12",
    source: "/coding-agent-setup",
    destination: "/build-with-agents",
  },
  {
    id: "R13",
    source: "/copilot-suggestions",
    destination: "/reference/v2/hooks/useSuggestions",
  },
  // /direct-to-llm content is the Built-in Agent docs, which are served
  // at the root; the retired /integrations/built-in-agent landing route
  // also goes home.
  { id: "R14", source: "/direct-to-llm", destination: "/" },
  {
    id: "R15",
    source: "/integrations/built-in-agent",
    destination: "/",
  },
  { id: "R16A", source: "/integrations", destination: "/" },
  { id: "R18", source: "/mcp", destination: "/build-with-agents" },
  { id: "R19", source: "/vibe-coding-mcp", destination: "/build-with-agents" },
  {
    id: "R21",
    source: "/ag-ui-protocol",
    destination: "/agentic-protocols/ag-ui",
  },
  {
    id: "R22",
    source: "/connect-mcp-servers",
    destination: "/agentic-protocols/mcp",
  },
  {
    id: "R23",
    source: "/a2a-protocol",
    destination: "/agentic-protocols/a2a",
  },
  {
    id: "R24",
    source: "/architecture",
    destination: "/concepts/architecture",
  },
  // NOTE: the former R25 (`/runtime-server-adapter` →
  // `/backend/copilot-runtime`) was removed. `runtime-server-adapter.mdx`
  // is a distinct, current "Deploy to any runtime" page (deploying the
  // runtime on Express/Hono/Bun/Deno/CF Workers) — not a copilot-runtime
  // alias — and it's linked from the docs sidebar. The redirect shadowed
  // the real page, sending the sidebar's "Deploy to any runtime" entry to
  // the unrelated Copilot Runtime page.
  // Broken link fixes (B1-B3)
  {
    id: "B1",
    source: "/guides/custom-look-and-feel/bring-your-own-components",
    destination: "/custom-look-and-feel/slots",
  },
  {
    id: "B2",
    source: "/guides/self-hosting",
    destination: "/backend/copilot-runtime",
  },
  {
    id: "B3",
    source: "/guides/backend-actions/remote-backend-endpoint",
    destination: "/backend/copilot-runtime",
  },
];

// NOTE: the former BIA_DEFAULT_ROOT_REDIRECTS section (`/<bia-page>` →
// `/built-in-agent/<bia-page>`) was retired when the Built-in Agent
// docs moved to the root surface: those bare URLs now render the
// BIA-authored pages directly, and redirecting them would loop against
// next.config.ts's `/built-in-agent/:path*` → `/:path*` rule.

// ---------------------------------------------------------------------------
// Moved root pages — topics that used to be addressable at `/<page>` in
// the legacy docs surface but moved into a new section under shell-docs.
// These don't fit under "renames" (the slug stays the same) — only the
// parent folder changed. Each maps to a real on-disk MDX file.
// ---------------------------------------------------------------------------

const MOVED_ROOT_REDIRECTS: RedirectEntry[] = [
  // /mcp-apps lived at `/generative-ui/mcp-apps` in legacy docs; the
  // bare `/mcp-apps` URL was used in external references (blog posts,
  // product copy) and now 404s.
  {
    id: "MV-mcp-apps",
    source: "/mcp-apps",
    destination: "/generative-ui/mcp-apps",
  },
  // /copilot-runtime and /custom-agent moved under /backend/ in
  // shell-docs; these cover the canonical legacy paths. (Note:
  // /runtime-server-adapter is NOT redirected — it's a live page; see
  // the removed-R25 note above.)
  {
    id: "MV-copilot-runtime",
    source: "/copilot-runtime",
    destination: "/backend/copilot-runtime",
  },
  {
    id: "MV-custom-agent",
    source: "/custom-agent",
    destination: "/backend/custom-agent",
  },
  // Deep Agents promoted from a langgraph subpath to its own
  // integration. L12/L13 (in LEGACY_CHAINS_EXACT) cover the
  // /langgraph/deep-agents and /langgraph-python/deep-agents variants;
  // this catches the bare /deep-agents URL.
  {
    id: "MV-deep-agents",
    source: "/deep-agents",
    destination: "/deepagents",
  },
  // /multi-agent-flows is a LangGraph-only topic. The bare URL was
  // never authored agnostically; send legacy hits to the LangGraph
  // (Python) variant, which is the dominant traffic source.
  {
    id: "MV-multi-agent-flows",
    source: "/multi-agent-flows",
    destination: "/langgraph-python/multi-agent-flows",
  },
  // /generative-ui/specs/* — the "specs" subgroup was retired in
  // favour of flat /generative-ui/<spec> pages. The /learn/ tree's
  // legacy variant is already covered upstream; these catch the
  // /generative-ui/specs/* surface directly.
  {
    id: "MV-gs-mcp-apps",
    source: "/generative-ui/specs/mcp-apps",
    destination: "/generative-ui/mcp-apps",
  },
  {
    id: "MV-gs-a2ui",
    source: "/generative-ui/specs/a2ui",
    destination: "/generative-ui/a2ui",
  },
  {
    id: "MV-gs-open-json-ui",
    source: "/generative-ui/specs/open-json-ui",
    destination: "/generative-ui/open-json-ui",
  },
  {
    id: "MV-gs-root",
    source: "/generative-ui/specs",
    destination: "/concepts/generative-ui-overview",
  },
  // /custom-look-and-feel folder index — no index.mdx exists, so the
  // bare folder URL 404s. /slots is the canonical first-page entry
  // (matches what the sidebar opens by default).
  {
    id: "MV-clf-root",
    source: "/custom-look-and-feel",
    destination: "/custom-look-and-feel/slots",
  },
  // /custom-look-and-feel/customize-built-in-ui-components was a
  // pre-cutover page that consolidated into /slots. The /unselected/
  // variant is handled in next.config.ts; this catches the canonical
  // (non-prefixed) legacy URL.
  {
    id: "MV-clf-customize",
    source: "/custom-look-and-feel/customize-built-in-ui-components",
    destination: "/custom-look-and-feel/slots",
  },
  // /what-is-copilotkit was a landing alias in legacy docs (referenced
  // from CONTRIBUTING.md). Send to the home page.
  {
    id: "MV-what-is",
    source: "/what-is-copilotkit",
    destination: "/",
  },
  // /getting-started/quickstart-chatbot — legacy quickstart URL used
  // in older marketing copy. /quickstart already redirects to the BIA
  // quickstart (handled in next.config.ts).
  {
    id: "MV-gs-qs-chatbot",
    source: "/getting-started/quickstart-chatbot",
    destination: "/quickstart",
  },
  // NOTE: the former MV-telemetry entry (`/telemetry` →
  // `/built-in-agent/telemetry`) was retired with the root-served BIA
  // surface — the bare URL renders the BIA telemetry page directly.
  // /reference/hooks/useCoAgent — useCoAgent (v1) was renamed to
  // useAgent (v2). External links still point at the old name.
  {
    id: "MV-ref-useCoAgent",
    source: "/reference/hooks/useCoAgent",
    destination: "/reference/hooks/useAgent",
  },
  // /migration-guides → /migrate (MG1-MG4 in MIGRATION_GUIDES cover
  // most entries; migrate-attachments wasn't in that set).
  {
    id: "MV-mg-attachments",
    source: "/migration-guides/migrate-attachments",
    destination: "/migrate/v2",
  },
  // /migration/* — pre-rename of /migrate/* and /migration-guides/*.
  // Covers the singular "migration" prefix used by a few older docs.
  {
    id: "MV-migration-render-message",
    source: "/migration/render-message",
    destination: "/migrate/v2",
  },
];

const FRONTEND_PLATFORM_REDIRECTS: RedirectEntry[] = [
  {
    id: "FE-frontends",
    source: "/frontends",
    destination: "/",
  },
  {
    id: "FE-frontends-react",
    source: "/frontends/react",
    destination: "/",
  },
  {
    id: "FE-frontends-react-wild",
    source: "/frontends/react/:path*",
    destination: "/:path*",
  },
  {
    id: "FE-frontends-wild",
    source: "/frontends/:path*",
    destination: "/:path*",
  },
  {
    id: "FE-teams",
    source: "/microsoft-teams",
    destination: "/teams",
  },
  {
    id: "FE-teams-wild",
    source: "/microsoft-teams/:path*",
    destination: "/teams/:path*",
  },
];

// ---------------------------------------------------------------------------
// Legacy `/integrations/<fw>/*` URL surface — the upstream Fumadocs
// site rewrote /<fw>/<path> → /integrations/<fw>/<path> internally,
// and authored external links sometimes leaked the rewritten form. R15
// + R17 (above) cover the built-in-agent variant; this section covers
// the remaining frameworks. The /docs/integrations/* variants are
// already handled by DOCS_INTEGRATIONS_RENAMES below.
// ---------------------------------------------------------------------------

const INTEGRATIONS_PREFIX_RENAMES: RedirectEntry[] = FRAMEWORKS.filter(
  (fw) => fw !== "unselected",
).flatMap((fw) => {
  const fwDest = canonicalSlug(fw);
  return [
    {
      id: `INT-wild×${fw}`,
      source: `/integrations/${fw}/:path*`,
      destination: `/${fwDest}/:path*`,
    },
    {
      id: `INT-root×${fw}`,
      source: `/integrations/${fw}`,
      destination: `/${fwDest}`,
    },
  ];
});

// ---------------------------------------------------------------------------
// Category 2: Legacy Redirect Chains (coagents -> langgraph-python, crewai-crews -> crewai-crews)
// Specific entries BEFORE the catch-all wildcards
// ---------------------------------------------------------------------------

const LEGACY_CHAINS_EXACT: RedirectEntry[] = [
  {
    id: "L1",
    source: "/coagents",
    destination: "/langgraph-python",
  },
  {
    id: "L2",
    source: "/coagents/quickstart",
    destination: "/langgraph-python/quickstart",
  },
  {
    id: "L3",
    source: "/coagents/frontend-actions",
    destination: "/langgraph-python/frontend-tools",
  },
  {
    id: "L4",
    source: "/coagents/generative-ui",
    destination: "/langgraph-python/generative-ui",
  },
  {
    id: "L5",
    source: "/coagents/human-in-the-loop",
    destination: "/langgraph-python/human-in-the-loop",
  },
  {
    id: "L6",
    source: "/coagents/multi-agent-flows",
    destination: "/langgraph-python/multi-agent-flows",
  },
  {
    id: "L7",
    source: "/coagents/persistence",
    destination: "/langgraph-python/advanced/persistence",
  },
  {
    id: "L8",
    source: "/coagents/shared-state",
    destination: "/langgraph-python/shared-state",
  },
  {
    id: "L9",
    source: "/coagents/concepts",
    destination: "/langgraph-python",
  },
  {
    id: "L10",
    source: "/coagents/tutorials",
    destination: "/langgraph-python/tutorials",
  },
  {
    id: "L11",
    source: "/coagents/videos",
    destination: "/langgraph-python/videos",
  },
  // Deep Agents was promoted from a langgraph subpath to its own
  // top-level integration. Catch the legacy (langgraph) and the
  // post-slug-rename (langgraph-python) variants both, pointing them at
  // the canonical /deepagents placeholder. When the showcase
  // integration ships, these targets continue to resolve unchanged.
  {
    id: "L12",
    source: "/langgraph/deep-agents",
    destination: "/deepagents",
  },
  {
    id: "L13",
    source: "/langgraph-python/deep-agents",
    destination: "/deepagents",
  },
];

// ---------------------------------------------------------------------------
// /docs/integrations/* — legacy SHELL routing surface
// shell-docs serves at the host root with no /docs/ prefix, so any
// upstream URL still pointing at /docs/integrations/{fw}/... must 301
// to /{fw-slug}/... (with the slug rename applied).
// ---------------------------------------------------------------------------

const DOCS_INTEGRATIONS_RENAMES: RedirectEntry[] = FRAMEWORKS.flatMap((fw) => {
  const fwDest = canonicalSlug(fw);
  // The unselected/ tree's canonical owner (Built-in Agent) is served
  // at the root surface, so its destinations carry no framework prefix.
  const destPrefix = destinationPrefix(fwDest);
  return [
    {
      id: `DI-wild×${fw}`,
      source: `/docs/integrations/${fw}/:path*`,
      destination: `${destPrefix}/:path*`,
    },
    {
      id: `DI-root×${fw}`,
      source: `/docs/integrations/${fw}`,
      destination: destinationPath(fwDest),
    },
  ];
});

const DOCS_INTEGRATIONS_INDEX: RedirectEntry[] = [
  {
    id: "DI-index",
    source: "/docs/integrations",
    destination: "/",
  },
  {
    id: "DI-index-wild",
    source: "/docs/integrations/:path*",
    destination: "/:path*",
  },
];

// ---------------------------------------------------------------------------
// /docs/* — legacy SHELL routing prefix on root pages
// shell-docs has no /docs/ prefix, so /docs/foo → /foo.
// ---------------------------------------------------------------------------

const DOCS_PREFIX: RedirectEntry[] = [
  // /docs as a bare path lands on the home.
  { id: "DOCS-root", source: "/docs", destination: "/" },
  // Catch-all comes LAST — see WILDCARD_REDIRECTS for placement.
];

// ---------------------------------------------------------------------------
// /migration-guides/* → /migrate/* (4 URLs)
// ---------------------------------------------------------------------------

const MIGRATION_GUIDES: RedirectEntry[] = [
  { id: "MG1", source: "/migration-guides", destination: "/migrate/v2" },
  { id: "MG2", source: "/migration-guides/v2", destination: "/migrate/v2" },
  {
    id: "MG2a",
    source: "/migration-guides/migrate-to-v2",
    destination: "/migrate/v2",
  },
  {
    id: "MG3",
    source: "/migration-guides/1.10.X",
    destination: "/migrate/1.10.X",
  },
  {
    id: "MG3a",
    source: "/migration-guides/migrate-to-1.10.X",
    destination: "/migrate/1.10.X",
  },
  {
    id: "MG4",
    source: "/migration-guides/1.8.2",
    destination: "/migrate/1.8.2",
  },
  {
    id: "MG4a",
    source: "/migration-guides/migrate-to-1.8.2",
    destination: "/migrate/1.8.2",
  },
];

// ---------------------------------------------------------------------------
// Folder-index redirects for shell-docs folders that lack an index.mdx.
// These hit when a user navigates to the bare folder URL — without an
// index page Next.js would 404. Each folder URL 301s to a sensible
// representative inner page.
// ---------------------------------------------------------------------------

const FOLDER_INDEX: RedirectEntry[] = [
  {
    id: "FI-troubleshooting",
    source: "/troubleshooting",
    destination: "/troubleshooting/common-issues",
  },
  {
    id: "FI-migrate",
    // Mirrors the existing /migrate → /migrate/v2 entry in
    // showcase/shell-docs/next.config.ts, kept here so the SHELL host's
    // middleware also covers it during the cutover.
    source: "/migrate",
    destination: "/migrate/v2",
  },
  {
    id: "FI-premium",
    source: "/premium",
    destination: "/premium/overview",
  },
  {
    id: "FI-concepts",
    source: "/concepts",
    destination: "/concepts/architecture",
  },
  // FI-reference removed: /reference now has a proper index page
  // (app/reference/page.tsx) that lists components + hooks. The legacy
  // redirect to /reference/v2 — a path that no longer exists — left the
  // index broken.
];

// ---------------------------------------------------------------------------
// Retired Intelligence Platform pages.
// ---------------------------------------------------------------------------

const RETIRED_INTELLIGENCE_REDIRECTS: RedirectEntry[] = [
  {
    id: "INTEL-observability-root",
    source: "/premium/observability",
    destination: "/premium/overview",
  },
  {
    id: "INTEL-observability-connectors",
    source: "/troubleshooting/observability-connectors",
    destination: "/premium/overview",
  },
  ...CANONICAL_FRAMEWORKS.map((framework) => ({
    id: `INTEL-observability×${framework}`,
    source: `/${framework}/premium/observability`,
    destination: destinationPath(framework, "premium/overview"),
  })),
];

// ---------------------------------------------------------------------------
// Slug-rename catch-alls — bare /{old-slug}/* → /{new-slug}/*
// Covers upstream URLs that hit a renamed framework root or any
// subpath that isn't already matched by the more specific entries
// above.
// ---------------------------------------------------------------------------

const SLUG_RENAME_REDIRECTS: RedirectEntry[] = Object.entries(
  SLUG_RENAMES,
).flatMap(([oldSlug, newSlug]) => [
  {
    id: `SR-wild×${oldSlug}`,
    source: `/${oldSlug}/:path*`,
    destination: `${destinationPrefix(newSlug)}/:path*`,
  },
  {
    id: `SR-root×${oldSlug}`,
    source: `/${oldSlug}`,
    destination: destinationPath(newSlug),
  },
]);

// ---------------------------------------------------------------------------
// Wildcard redirects (legacy chains + pattern rules)
// These MUST come LAST — they are catch-alls
// ---------------------------------------------------------------------------

const WILDCARD_REDIRECTS: RedirectEntry[] = [
  // Category 2 wildcards
  {
    id: "L12",
    source: "/coagents/:path*",
    destination: "/langgraph-python/:path*",
  },
  // Category 4 wildcards — direct-to-llm and /integrations/built-in-agent
  // retire to the root-served BIA surface
  {
    id: "R16",
    source: "/direct-to-llm/:path*",
    destination: "/:path*",
  },
  {
    id: "R17",
    source: "/integrations/built-in-agent/:path*",
    destination: "/:path*",
  },
  { id: "R26", source: "/shared/:path*", destination: "/:path*" },
  // Category 6 wildcards
  {
    id: "F17",
    source: "/generative-ui/direct-to-llm/:path*",
    destination: "/:path*",
  },
  {
    id: "F18",
    source: "/generative-ui/langgraph/:path*",
    destination: "/langgraph-python/:path*",
  },
  {
    id: "F19",
    source: "/generative-ui-specs/:path*",
    destination: "/generative-ui/specs/:path*",
  },
  // Tutorials deprecation: section retired post-cutover. Framework-scoped
  // tutorial URLs redirect to that framework's quickstart; unscoped variants
  // redirect to the docs root. Must precede the per-framework P1×/P2×
  // catch-alls below.
  ...CANONICAL_FRAMEWORKS.map((fw) => ({
    id: `T1×${fw}`,
    source: `/${fw}/tutorials/:path*`,
    destination: destinationPath(fw, "quickstart"),
  })),
  {
    id: "T1-unscoped-wild",
    source: "/tutorials/:path*",
    destination: "/",
  },
  { id: "T1-unscoped-root", source: "/tutorials", destination: "/" },
  // Category 1: Pattern rules (bulk coverage)
  // The /guides tree no longer exists anywhere (its old BIA destination
  // 404'd, and pointing it back at /guides/* would self-loop), so the
  // retired section sends readers home.
  {
    id: "P11",
    source: "/guides/:path*",
    destination: "/",
  },
  { id: "P3", source: "/learn/:path*", destination: "/concepts/:path*" },
  // P1 + P2: Per-framework catch-alls (MUST be last — they match any /{framework}/*)
  // Source is the legacy slug; destination uses canonical slug. Skip
  // frameworks whose slug is unchanged — those would be self-loops.
  ...FRAMEWORKS.filter((fw) => canonicalSlug(fw) !== fw).map((fw) => ({
    id: `P1×${fw}`,
    source: `/${fw}/:path*`,
    destination: `${destinationPrefix(canonicalSlug(fw))}/:path*`,
  })),
  ...FRAMEWORKS.filter((fw) => canonicalSlug(fw) !== fw).map((fw) => ({
    id: `P2×${fw}`,
    source: `/${fw}`,
    destination: destinationPath(canonicalSlug(fw)),
  })),
  // /docs/* generic catch-all (must come AFTER /docs/integrations/* so
  // the more specific /docs/integrations entries match first).
  { id: "DOCS-wild", source: "/docs/:path*", destination: "/:path*" },
];

// ---------------------------------------------------------------------------
// Combined export — ordered most-specific to least-specific
// Middleware evaluates top-to-bottom, first match wins
// ---------------------------------------------------------------------------

export const seoRedirects: RedirectEntry[] = [
  // 1. Most-specific exact paths first
  ...DEEP_COAGENTS,
  ...SPECIFIC_FRAMEWORK,
  ...CODING_AGENTS_RENAMES,
  ...ROOT_RENAMES,
  ...MOVED_ROOT_REDIRECTS,
  ...FRONTEND_PLATFORM_REDIRECTS,
  ...LEGACY_CHAINS_EXACT,
  ...DOCS_INTEGRATIONS_INDEX.filter((e) => !e.source.includes(":path*")),
  ...DOCS_INTEGRATIONS_RENAMES.filter((e) => !e.source.includes(":path*")),
  ...INTEGRATIONS_PREFIX_RENAMES.filter((e) => !e.source.includes(":path*")),
  ...DOCS_PREFIX,
  ...MIGRATION_GUIDES,
  ...RETIRED_INTELLIGENCE_REDIRECTS,
  ...FOLDER_INDEX,
  // 2. Generated per-framework subpath renames (exact paths)
  ...generateFrameworkRenames(),
  // 3. Wildcard catch-alls last — order matters: most-specific wildcard first
  ...DOCS_INTEGRATIONS_RENAMES.filter((e) => e.source.includes(":path*")),
  ...DOCS_INTEGRATIONS_INDEX.filter((e) => e.source.includes(":path*")),
  ...INTEGRATIONS_PREFIX_RENAMES.filter((e) => e.source.includes(":path*")),
  ...SLUG_RENAME_REDIRECTS,
  ...WILDCARD_REDIRECTS,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeRedirectPathname(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] || "/";
  return pathOnly.length > 1 && pathOnly.endsWith("/")
    ? pathOnly.slice(0, -1)
    : pathOnly;
}

function redirectSourceToRegExp(source: string): RegExp {
  const pattern = source
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) {
        return segment.endsWith("*") ? "(?:/.*)?" : "/[^/]+";
      }

      return `/${escapeRegExp(segment)}`;
    })
    .join("");

  return new RegExp(`^${pattern || "/"}$`);
}

const seoRedirectSourceMatchers = seoRedirects.map((entry) =>
  redirectSourceToRegExp(entry.source),
);

export function matchesSeoRedirectSource(pathname: string): boolean {
  const normalizedPathname = normalizeRedirectPathname(pathname);
  return seoRedirectSourceMatchers.some((matcher) =>
    matcher.test(normalizedPathname),
  );
}
