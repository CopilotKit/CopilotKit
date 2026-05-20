import type { NextConfig } from "next";

// NEXT_PUBLIC_BASE_URL is inlined automatically by Next.js at build time
// because of the NEXT_PUBLIC_ prefix. Do NOT re-declare it in an `env` block —
// doing so bakes the build-time value into server code and overrides runtime env.
//
// Consumers in production: src/app/sitemap.ts, src/app/robots.ts, and the
// per-page `generateMetadata()` canonical URLs in the catch-all routes
// (src/app/[[...slug]]/page.tsx, src/app/[framework]/[[...slug]]/page.tsx,
// src/app/reference/[...slug]/page.tsx, src/app/ag-ui/[[...slug]]/page.tsx).
// All read it through `getBaseUrl()` in src/lib/sitemap-helpers.ts, which
// falls back to https://docs.copilotkit.ai when unset.
//
// Fail fast during an actual `next build` if the variable is missing, so we
// never ship broken absolute URLs. Other invocations that also load this
// config (e.g. `next lint`, `next dev`) only warn, because failing them on a
// missing value would be noise — consumers are expected to handle the dev
// fallback themselves (e.g. `process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3003"`).
//
// Use NEXT_PHASE — the Next.js-canonical signal for production builds —
// rather than sniffing process.argv, which is fragile (e.g. broken under
// wrappers, turbo runs, or when invoked programmatically).
const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";

if (!process.env.NEXT_PUBLIC_BASE_URL) {
  if (isNextBuild) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL is required for `next build` of showcase/shell-docs. " +
        "Set it in the environment (e.g. https://your-domain.example) before running the build.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[shell-docs] NEXT_PUBLIC_BASE_URL is not set; consumers should fall back to a sensible dev default (e.g. http://localhost:3003).",
  );
}

// NEXT_PUBLIC_SHELL_URL points at the shell (showcase) host, which owns
// `/integrations` and `/matrix` — the live integration explorer and
// feature-matrix pages. Components use it directly in cross-host hrefs
// (e.g. the top-nav "Integrations" link). Same validation pattern as
// NEXT_PUBLIC_BASE_URL above: fail at `next build` if missing; warn in dev.
if (!process.env.NEXT_PUBLIC_SHELL_URL) {
  if (isNextBuild) {
    throw new Error(
      "NEXT_PUBLIC_SHELL_URL is required for `next build` of showcase/shell-docs. " +
        "Set it to the shell host before running the build.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[shell-docs] NEXT_PUBLIC_SHELL_URL is not set; consumers should fall back to a sensible dev default (e.g. http://localhost:3000).",
  );
}

const nextConfig: NextConfig = {
  images: {
    // Asset CDN for framework intro-page media (banner videos, architecture
    // diagrams, supported-feature thumbnails, framework icons). Hosts every
    // image/video referenced by `src/data/frameworks/*.ts` and any future
    // marketing surface that pulls from the shared CDN.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.copilotkit.ai",
      },
    ],
  },
  async rewrites() {
    return {
      beforeFiles: [
        // PostHog reverse proxy — routes analytics through this host so
        // requests bypass ad blockers / tracking-protection that target
        // the *.i.posthog.com hostname directly. Mirrors docs/.
        {
          source: "/ingest/static/:path*",
          destination: "https://eu-assets.i.posthog.com/static/:path*",
        },
        {
          source: "/ingest/:path*",
          destination: "https://eu.i.posthog.com/:path*",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    return [
      {
        // Built-in agent is the default framework, so its overview page
        // is the docs root. Avoid surfacing a redundant "Introduction"
        // entry inside the built-in-agent sidebar by canonicalizing the
        // bare /built-in-agent URL to the root overview.
        source: "/built-in-agent",
        destination: "/",
        permanent: true,
      },
      {
        source: "/frontend-actions",
        destination: "/frontend-tools",
        permanent: true,
      },
      {
        source: "/troubleshooting/migrate-to-v2",
        destination: "/migrate/v2",
        permanent: true,
      },
      {
        source: "/troubleshooting/migrate-to-1.10.X",
        destination: "/migrate/1.10.X",
        permanent: true,
      },
      {
        source: "/troubleshooting/migrate-to-1.8.2",
        destination: "/migrate/1.8.2",
        permanent: true,
      },
      {
        source: "/concepts/oss-vs-cloud",
        destination: "/concepts/oss-vs-enterprise",
        permanent: true,
      },
      // Quickstart needs a real backing page when hit without a stored
      // framework. `SidebarLink` rewrites `/quickstart` → `/<framework>/quickstart`
      // when a framework is selected; users who land here cold (or who
      // explicitly picked the bare CopilotKit / Built-in Agent view)
      // get the Built-in Agent quickstart by default. 308 keeps the
      // sidebar's `/quickstart` href intact while always sending the
      // user to a real guide.
      {
        source: "/quickstart",
        destination: "/built-in-agent/quickstart",
        permanent: true,
      },

      // /unselected/* tree retired. Files moved to integrations/built-in-agent/
      // (BIA replaced the old "unselected" slot as the default integration).
      // Per-path entries below cover BIA-canonical mappings (direct moves +
      // slug renames from SUBPATH_RENAMES in seo-redirects.ts); the catch-all
      // at the bottom routes everything else into /built-in-agent/ to preserve
      // SEO equity, since these legacy URLs historically served BIA content.
      {
        source: "/unselected",
        destination: "/built-in-agent",
        permanent: true,
      },
      {
        source: "/unselected/quickstart",
        destination: "/built-in-agent/quickstart",
        permanent: true,
      },
      {
        source: "/unselected/advanced-configuration",
        destination: "/built-in-agent/advanced-configuration",
        permanent: true,
      },
      {
        source: "/unselected/mcp-servers",
        destination: "/built-in-agent/mcp-servers",
        permanent: true,
      },
      {
        source: "/unselected/model-selection",
        destination: "/built-in-agent/model-selection",
        permanent: true,
      },
      {
        source: "/unselected/server-tools",
        destination: "/built-in-agent/server-tools",
        permanent: true,
      },
      {
        source: "/unselected/shared-state",
        destination: "/built-in-agent/shared-state",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/mcp-apps",
        destination: "/built-in-agent/generative-ui/mcp-apps",
        permanent: true,
      },
      // Cat C promotions whose canonical home moved off the unselected
      // tail (e.g. `unselected/ag-ui` → `backend/ag-ui`).
      {
        source: "/unselected/ag-ui",
        destination: "/backend/ag-ui",
        permanent: true,
      },
      {
        source: "/unselected/copilot-runtime",
        destination: "/backend/copilot-runtime",
        permanent: true,
      },
      // custom-agent: consolidate two divergent shell-docs copies onto the
      // structurally-complete backend/custom-agent.mdx (508 lines, matches
      // upstream snippet). The integrations/built-in-agent/custom-agent.mdx
      // copy (240 lines, missing 5 sections) was retired; redirect both
      // historical paths.
      {
        source: "/built-in-agent/custom-agent",
        destination: "/backend/custom-agent",
        permanent: true,
      },
      {
        source: "/integrations/built-in-agent/custom-agent",
        destination: "/backend/custom-agent",
        permanent: true,
      },
      // troubleshooting/migrate-to-* in unselected → existing
      // /migrate/* canonical (already redirected at the
      // /troubleshooting/migrate-to-* level).
      {
        source: "/unselected/troubleshooting/migrate-to-v2",
        destination: "/migrate/v2",
        permanent: true,
      },
      {
        source: "/unselected/troubleshooting/migrate-to-1.10.X",
        destination: "/migrate/1.10.X",
        permanent: true,
      },
      {
        source: "/unselected/troubleshooting/migrate-to-1.8.2",
        destination: "/migrate/1.8.2",
        permanent: true,
      },
      // Tutorials and interrupt-based moved out of unselected/ to root.
      {
        source: "/unselected/tutorials/:path*",
        destination: "/tutorials/:path*",
        permanent: true,
      },
      // Interrupt-based was a LangGraph-specific page parked in
      // unselected/. Real homes are
      // `/<langgraph-slug>/human-in-the-loop/interrupt-flow` (and the
      // Mastra equivalent). Send anyone landing on the legacy URL to
      // the framework-agnostic HITL page; soft-default routes them
      // through to the right framework's interrupt flow if they're
      // stored as LangGraph or Mastra.
      {
        source: "/unselected/generative-ui/your-components/interrupt-based",
        destination: "/human-in-the-loop",
        permanent: true,
      },
      // agent-app-context was concept-per-framework only; no canonical
      // root home. Send legacy URLs to `/` rather than 404 — readers
      // who stored the old link will land on docs and can navigate.
      {
        source: "/unselected/agent-app-context",
        destination: "/",
        permanent: true,
      },
      // Slug-rename entries (mirror SUBPATH_RENAMES in seo-redirects.ts).
      // These MUST come before the catch-all so the rename wins. Each
      // historical slug under /unselected/ has been renamed under
      // /built-in-agent/; e.g. agentic-chat-ui → prebuilt-components.
      {
        source: "/unselected/agentic-chat-ui",
        destination: "/built-in-agent/prebuilt-components",
        permanent: true,
      },
      {
        source: "/unselected/use-agent-hook",
        destination: "/built-in-agent/programmatic-control",
        permanent: true,
      },
      {
        source: "/unselected/frontend-actions",
        destination: "/built-in-agent/frontend-tools",
        permanent: true,
      },
      {
        source: "/unselected/vibe-coding-mcp",
        destination: "/built-in-agent/coding-agents",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/agentic",
        destination:
          "/built-in-agent/generative-ui/your-components/display-only",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/backend-tools",
        destination: "/built-in-agent/generative-ui/tool-rendering",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/frontend-tools",
        destination: "/built-in-agent/frontend-tools",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/render-only",
        destination:
          "/built-in-agent/generative-ui/your-components/display-only",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/tool-based",
        destination: "/built-in-agent/generative-ui/tool-rendering",
        permanent: true,
      },
      {
        source: "/unselected/custom-look-and-feel/bring-your-own-components",
        destination: "/built-in-agent/custom-look-and-feel/slots",
        permanent: true,
      },
      {
        source:
          "/unselected/custom-look-and-feel/customize-built-in-ui-components",
        destination: "/built-in-agent/custom-look-and-feel/slots",
        permanent: true,
      },
      {
        source: "/unselected/custom-look-and-feel/markdown-rendering",
        destination: "/built-in-agent/custom-look-and-feel/slots",
        permanent: true,
      },
      {
        source: "/unselected/guide",
        destination: "/built-in-agent/guides",
        permanent: true,
      },
      {
        source: "/unselected/mcp",
        destination: "/built-in-agent/coding-agents",
        permanent: true,
      },
      // Catch-all: route remaining /unselected/* paths into /built-in-agent/.
      // BIA is the canonical owner of the legacy unselected/ content tree;
      // matches P1×unselected in seo-redirects.ts.
      {
        source: "/unselected/:path*",
        destination: "/built-in-agent/:path*",
        permanent: true,
      },

      // /learn/* tree retired. The seven explanation-tier pages were
      // promoted into the Concepts subgroup, the multi-conversation
      // tutorial moved to /tutorials/, the open-json-ui page moved to
      // /generative-ui/, and the What's New tree became its own
      // top-level section. Redirects below funnel old URLs to the
      // canonical homes.
      {
        source: "/learn",
        destination: "/concepts/architecture",
        permanent: true,
      },
      {
        source: "/learn/architecture",
        destination: "/concepts/architecture",
        permanent: true,
      },
      {
        source: "/learn/threads",
        destination: "/premium/threads-explained",
        permanent: true,
      },
      {
        source: "/learn/intelligence-platform",
        destination: "/premium/intelligence-platform",
        permanent: true,
      },
      {
        source: "/learn/agentic-protocols",
        destination: "/agentic-protocols",
        permanent: true,
      },
      {
        source: "/learn/ag-ui-protocol",
        destination: "/agentic-protocols/ag-ui",
        permanent: true,
      },
      {
        source: "/learn/a2a-protocol",
        destination: "/agentic-protocols/a2a",
        permanent: true,
      },
      {
        source: "/learn/connect-mcp-servers",
        destination: "/agentic-protocols/mcp",
        permanent: true,
      },
      {
        source: "/learn/generative-ui",
        destination: "/concepts/generative-ui-overview",
        permanent: true,
      },
      {
        source: "/learn/generative-ui/specs/open-json-ui",
        destination: "/generative-ui/open-json-ui",
        permanent: true,
      },
      {
        source: "/learn/generative-ui/specs/a2ui",
        destination: "/generative-ui/a2ui",
        permanent: true,
      },
      {
        source: "/learn/generative-ui/specs/mcp-apps",
        destination: "/generative-ui/mcp-apps",
        permanent: true,
      },
      {
        source: "/learn/generative-ui/specs",
        destination: "/concepts/generative-ui-overview",
        permanent: true,
      },
      {
        source: "/learn/tutorials/multi-conversation-chat",
        destination: "/tutorials/multi-conversation-chat",
        permanent: true,
      },
      {
        source: "/learn/whats-new/:path*",
        destination: "/whats-new/:path*",
        permanent: true,
      },
      {
        source: "/learn/whats-new",
        destination: "/whats-new",
        permanent: true,
      },

      // Concepts subgroup tightened: protocol pages moved into a new
      // /agentic-protocols/ section under Get Started, the
      // Intelligence Platform + Threads explanation pages moved to
      // Enterprise (/premium/), and three-types-of-gen-ui merged into
      // /concepts/generative-ui-overview. Per-path redirects below
      // catch URLs that were live in the brief window between the
      // first /learn/ consolidation pass and this restructure.
      {
        source: "/concepts/agentic-protocols",
        destination: "/agentic-protocols",
        permanent: true,
      },
      {
        source: "/concepts/ag-ui-protocol",
        destination: "/agentic-protocols/ag-ui",
        permanent: true,
      },
      {
        source: "/concepts/mcp-servers",
        destination: "/agentic-protocols/mcp",
        permanent: true,
      },
      {
        source: "/concepts/a2a-protocol",
        destination: "/agentic-protocols/a2a",
        permanent: true,
      },
      {
        source: "/concepts/intelligence-platform",
        destination: "/premium/intelligence-platform",
        permanent: true,
      },
      {
        source: "/concepts/threads",
        destination: "/premium/threads-explained",
        permanent: true,
      },
      {
        source: "/concepts/three-types-of-gen-ui",
        destination: "/concepts/generative-ui-overview",
        permanent: true,
      },

      // Stale pages hidden pre-launch. 302 (not permanent) — these
      // URLs may be restored once the underlying content is rewritten.
      // Tutorials are broken end-to-end and pulled from nav; files
      // remain on disk under content/docs/tutorials/ for post-launch
      // rewrite.
      {
        source: "/tutorials/:path*",
        destination: "/",
        permanent: false,
      },
      // Old-name straggler from the coding-agents rename; the page
      // moved to /coding-agents.
      {
        source: "/coding-agent-setup",
        destination: "/coding-agents",
        permanent: false,
      },
      // Orphaned broken stub.
      {
        source: "/copilot-suggestions",
        destination: "/",
        permanent: false,
      },
      // AI-slop placeholder pulled from nav until properly authored;
      // file stays on disk for rewrite.
      {
        source: "/generative-ui/open-json-ui",
        destination: "/generative-ui",
        permanent: false,
      },
      // ~1-year-old migration target, no longer a meaningful jump-off
      // point.
      {
        source: "/migrate/1.10.X",
        destination: "/migrate/v2",
        permanent: false,
      },

      // ag-ui-middleware moved into the agentic-protocols group so it
      // appears in the sidebar under AG-UI rather than as an orphan
      // root page. 302 (not 301) since the new home is recent and we
      // want flexibility to revisit placement without burning the
      // permanent-redirect cache.
      {
        source: "/ag-ui-middleware",
        destination: "/agentic-protocols/ag-ui-middleware",
        permanent: false,
      },

      // `/generative-ui/your-components/*` retired. The display-only
      // page was a duplicate of `/generative-ui/tool-based` (same hook,
      // same demo, same body); the interactive page duplicated the
      // Human-in-the-Loop section. 302 while the new IA settles.
      {
        source: "/generative-ui/your-components/display-only",
        destination: "/generative-ui/tool-based",
        permanent: false,
      },
      {
        source: "/:framework/generative-ui/your-components/display-only",
        destination: "/:framework/generative-ui/tool-based",
        permanent: false,
      },
      {
        source: "/generative-ui/your-components/interactive",
        destination: "/human-in-the-loop",
        permanent: false,
      },
      {
        source: "/:framework/generative-ui/your-components/interactive",
        destination: "/:framework/human-in-the-loop",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
