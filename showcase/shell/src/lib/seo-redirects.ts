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
 *
 * DOCS-HOST SHADOWING (middleware.ts): the docs-host redirect (step 1
 * in middleware — /docs, /ag-ui, /reference, /<registry-framework-slug>)
 * runs BEFORE this table, so several entry classes can never match on
 * the SHELL host and are effectively docs-host-only / dead here:
 *
 *   - every `/docs/*` source (R2, DI-*, DOCS-root, DOCS-wild): it 308s
 *     `/docs/:path*` to the docs host with the prefix stripped;
 *   - every `/reference*` source (FI-reference, P9, P10): it 308s
 *     `/reference/:path*` to the docs host with the prefix kept;
 *   - sources whose first segment is a CURRENT registry slug —
 *     today's registry-overlap slugs are `mastra`, `agno`, `ag2`,
 *     `llamaindex`, `pydantic-ai` and `crewai-crews` (e.g. F3-F6,
 *     S1×mastra, P1×agno, and L13/L14 — both /crewai-crews entries are
 *     dead here): the docs-host step forwards `/<slug>/...` verbatim to
 *     the docs host. NOTE (SU4-A6): this list must enumerate EVERY
 *     table source whose FIRST segment is a registry slug — recheck it
 *     against registry.json whenever a slug is added or a source class
 *     is introduced.
 *
 * Verified double-hop behavior: such a request 308s to the docs host
 * with the path unchanged, and the DOCS host's own redirect layer then
 * applies the rename there (e.g. shell /mastra/quickstart/mastra →
 * docs-host /mastra/quickstart/mastra → docs-host /mastra/quickstart).
 * The entries stay in this table because validate-redirects.ts and the
 * decommission report still consume them, and because non-overlapping
 * legacy slugs (e.g. `langgraph`, `adk`, `aws-strands`) DO match here.
 */

export interface RedirectEntry {
  /** Spec ID (e.g., "L3", "S4×agno", "P1×langgraph") for cross-referencing Notion inventory */
  id: string;
  /** Source path pattern. Use :path* for wildcard suffix matching. */
  source: string;
  /**
   * Destination path on the DOCS routing surface (shell-docs serves at
   * the docs host root) — NOT on the showcase shell. Use :path* to
   * carry over the wildcard. middleware resolves these against the
   * runtime docsHost; resolving them against the shell origin is the
   * exact misconception behind the historic self-redirect loop (e.g.
   * M3 /faq -> shell /faq -> ERR_TOO_MANY_REDIRECTS).
   */
  destination: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Historical framework slugs that appear in legacy upstream URLs.
// These are the slugs the SEO surface SAW pre-cutover — destinations are
// remapped via SLUG_RENAMES below to the canonical shell-docs slugs.
//
// DATA-CONTRACT NOTE (SU5-A7): `a2a` and `agent-spec` have no
// SLUG_RENAMES entry AND are not registry framework slugs, so their
// generated destinations (e.g. /a2a/prebuilt-components) may 404 on the
// docs host — the redirects fire correctly but land on nothing. Flagged
// for the docs-host inventory check; until then they are kept for
// Notion-spec parity like the other generated classes.
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
    const fwDest = canonicalSlug(fw);
    // S13: concepts/* collapses to framework root
    entries.push({
      id: `S13w×${fw}`,
      source: `/${fw}/concepts/:path*`,
      destination: `/${fwDest}`,
    });
    entries.push({
      id: `S13e×${fw}`,
      source: `/${fw}/concepts`,
      destination: `/${fwDest}`,
    });

    for (const rename of SUBPATH_RENAMES) {
      entries.push({
        id: `${rename.specId}×${fw}`,
        source: `/${fw}/${rename.from}`,
        destination: `/${fwDest}/${rename.to}`,
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
    // Keeps the framework segment (aws-strands → canonical `strands`),
    // matching F11/F12, the S× renames and the P1×aws-strands
    // catch-all. An earlier revision dropped the segment
    // (→ /human-in-the-loop) with no spec justification, landing on the
    // framework-agnostic page instead of the strands one.
    source: "/aws-strands/human-in-the-loop",
    destination: "/strands/human-in-the-loop",
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
    destination: "/built-in-agent/coding-agents",
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
    destination: "/coding-agents",
  },
  {
    id: "R13",
    source: "/copilot-suggestions",
    destination: "/prebuilt-components",
  },
  // /direct-to-llm → built-in-agent (BIA canonical)
  //
  // R15 (/integrations/built-in-agent → /built-in-agent) is deliberately
  // ABSENT from this (shell) copy: it targets legacy DOCS-host URLs
  // (47 /integrations/built-in-agent/* URLs in the upstream sitemap —
  // see e2bef7a0b) and lives in the shell-docs copy where it belongs.
  // On the SHELL host, /integrations/built-in-agent is a LIVE registry
  // product page (linked from search-modal.tsx and
  // integration-explorer.tsx) that the entry would hijack — middleware's
  // namespace guard (its FIRST step, ahead of even the docs-host
  // redirect — SU4-A1) keeps EVERY redirect step out of /integrations/*,
  // structurally. Same applies to its wildcard twin R17 below.
  { id: "R14", source: "/direct-to-llm", destination: "/built-in-agent" },
  { id: "R18", source: "/mcp", destination: "/coding-agents" },
  { id: "R19", source: "/vibe-coding-mcp", destination: "/coding-agents" },
  {
    id: "R20",
    source: "/agentic-protocols",
    destination: "/agentic-protocols",
  },
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
  {
    id: "R25",
    source: "/runtime-server-adapter",
    destination: "/backend/copilot-runtime",
  },
  {
    id: "R27",
    source: "/whats-new/v1-50",
    destination: "/whats-new/v1-50",
  },
  // Manual overrides (Category 7) — root-level doc pages
  { id: "M2", source: "/quickstart", destination: "/" },
  { id: "M3", source: "/faq", destination: "/faq" },
  { id: "M4", source: "/frontend-tools", destination: "/frontend-tools" },
  {
    id: "M5",
    source: "/human-in-the-loop",
    destination: "/human-in-the-loop",
  },
  {
    id: "M6",
    source: "/prebuilt-components",
    destination: "/prebuilt-components",
  },
  { id: "M7", source: "/coding-agents", destination: "/coding-agents" },
  { id: "M8", source: "/telemetry", destination: "/telemetry" },
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

// ---------------------------------------------------------------------------
// Category 2: Legacy Redirect Chains (coagents -> langgraph-python; the
// /crewai-crews entries L13/L14 are SELF-redirects — crewai-crews is the
// canonical slug, and they are kept for inventory parity with the Notion
// spec, not because anything renames)
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
  // /crewai-crews is now the canonical slug — historical /crewai-crews
  // URLs land directly on the new framework root.
  {
    id: "L14",
    source: "/crewai-crews",
    destination: "/crewai-crews",
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
  return [
    {
      id: `DI-wild×${fw}`,
      source: `/docs/integrations/${fw}/:path*`,
      destination: `/${fwDest}/:path*`,
    },
    {
      id: `DI-root×${fw}`,
      source: `/docs/integrations/${fw}`,
      destination: `/${fwDest}`,
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
    id: "MG3",
    source: "/migration-guides/1.10.X",
    destination: "/migrate/v2",
  },
  {
    id: "MG4",
    source: "/migration-guides/1.8.2",
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
  {
    id: "FI-reference",
    // /reference is served by app/reference/[...slug] which has no index;
    // v2 is the active reference set.
    source: "/reference",
    destination: "/reference/v2",
  },
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
    destination: `/${newSlug}/:path*`,
  },
  {
    id: `SR-root×${oldSlug}`,
    source: `/${oldSlug}`,
    destination: `/${newSlug}`,
  },
]);

// ---------------------------------------------------------------------------
// Wildcard redirects (legacy chains + pattern rules)
// Order matters only RELATIVE TO OTHER WILDCARDS: middleware splits the
// table into an exact-match map and an ordered wildcard list, so exact
// entries always win regardless of where a wildcard sits. Among
// wildcards, earlier = higher priority (first matching prefix wins),
// which is why the more specific wildcard groups precede the
// per-framework P1× catch-alls below.
// ---------------------------------------------------------------------------

const WILDCARD_REDIRECTS: RedirectEntry[] = [
  // Category 2 wildcards
  {
    id: "L12",
    source: "/coagents/:path*",
    destination: "/langgraph-python/:path*",
  },
  {
    id: "L13",
    source: "/crewai-crews/:path*",
    destination: "/crewai-crews/:path*",
  },
  // Category 4 wildcards — direct-to-llm retires to BIA. R17
  // (/integrations/built-in-agent/:path*) is docs-host-only and lives in
  // the shell-docs copy — see the R15 note in ROOT_RENAMES above.
  {
    id: "R16",
    source: "/direct-to-llm/:path*",
    destination: "/built-in-agent/:path*",
  },
  { id: "R26", source: "/shared/:path*", destination: "/:path*" },
  // Category 6 wildcards
  {
    id: "F17",
    source: "/generative-ui/direct-to-llm/:path*",
    destination: "/built-in-agent/:path*",
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
  // Category 1: Pattern rules (bulk coverage)
  {
    id: "P9",
    source: "/reference/v2/:path*",
    destination: "/reference/v2/:path*",
  },
  { id: "P10", source: "/reference/v1/:path*", destination: "/reference/v2" },
  {
    id: "P11",
    source: "/guides/:path*",
    destination: "/built-in-agent/guides/:path*",
  },
  { id: "P12", source: "/backend/:path*", destination: "/backend/:path*" },
  // NOTE (SU5-A7): the BARE /learn (zero-segment :path*) lands on
  // docs-host /concepts, a folder with no index page — reaching content
  // depends on the DOCS host's own /concepts -> /concepts/architecture
  // redirect (the docs-host twin of FI-concepts above): a deliberate
  // double hop. If that docs-host redirect ever disappears, bare /learn
  // 404s even though this entry still fires.
  { id: "P3", source: "/learn/:path*", destination: "/concepts/:path*" },
  {
    id: "P4",
    source: "/troubleshooting/:path*",
    destination: "/troubleshooting/:path*",
  },
  {
    id: "P5",
    source: "/custom-look-and-feel/:path*",
    destination: "/custom-look-and-feel/:path*",
  },
  {
    id: "P6",
    source: "/generative-ui/:path*",
    destination: "/generative-ui/:path*",
  },
  { id: "P7", source: "/premium/:path*", destination: "/premium/:path*" },
  {
    id: "P8",
    source: "/contributing/:path*",
    destination: "/contributing/:path*",
  },
  // P1 + P2: Per-framework catch-alls (MUST be last — they match any /{framework}/*)
  // Source is the legacy slug; destination uses canonical slug.
  ...FRAMEWORKS.map((fw) => ({
    id: `P1×${fw}`,
    source: `/${fw}/:path*`,
    destination: `/${canonicalSlug(fw)}/:path*`,
  })),
  ...FRAMEWORKS.map((fw) => ({
    id: `P2×${fw}`,
    source: `/${fw}`,
    destination: `/${canonicalSlug(fw)}`,
  })),
  // /docs/* generic catch-all (must come AFTER /docs/integrations/* so
  // the more specific /docs/integrations entries match first).
  { id: "DOCS-wild", source: "/docs/:path*", destination: "/:path*" },
];

// ---------------------------------------------------------------------------
// Combined export — ordered most-specific to least-specific
//
// How middleware ACTUALLY evaluates this table (buildRedirectLookup in
// middleware.ts): entries are split into an exact-match map and an
// ordered wildcard list, and EVERY exact source is tried before ANY
// wildcard — an exact entry beats a wildcard even if the wildcard
// appears earlier in this array. "Top-to-bottom, first match wins"
// holds in two narrower senses: (a) among WILDCARDS, earlier entries
// have higher priority (the linear scan short-circuits), and (b) for
// DUPLICATE exact sources or duplicate wildcard prefixes, the first
// table entry claims the id (later duplicates are dropped with a
// module-load warn).
// ---------------------------------------------------------------------------

export const seoRedirects: RedirectEntry[] = [
  // 1. Most-specific exact paths first
  ...DEEP_COAGENTS,
  ...SPECIFIC_FRAMEWORK,
  ...ROOT_RENAMES,
  ...LEGACY_CHAINS_EXACT,
  ...DOCS_INTEGRATIONS_INDEX.filter((e) => !e.source.includes(":path*")),
  ...DOCS_INTEGRATIONS_RENAMES.filter((e) => !e.source.includes(":path*")),
  ...DOCS_PREFIX,
  ...MIGRATION_GUIDES,
  ...FOLDER_INDEX,
  // 2. Generated per-framework subpath renames (mostly exact paths,
  // plus the S13w×<fw> concepts/:path* wildcards)
  ...generateFrameworkRenames(),
  // 3. Wildcard catch-alls last — order matters: most-specific wildcard first
  ...DOCS_INTEGRATIONS_RENAMES.filter((e) => e.source.includes(":path*")),
  ...DOCS_INTEGRATIONS_INDEX.filter((e) => e.source.includes(":path*")),
  ...SLUG_RENAME_REDIRECTS,
  ...WILDCARD_REDIRECTS,
];
