import type { NextConfig } from "next";

// NEXT_PUBLIC_BASE_URL and NEXT_PUBLIC_SHELL_URL are read at REQUEST
// time by the server `getRuntimeConfig()` reader and injected into the
// client via `window.__SHOWCASE_CONFIG__` from the root layout. They
// are NOT build-time inputs — a single built artifact can serve staging
// and prod by changing the Railway env vars. Any previous build-time
// validation that threw on unset env vars would prevent that exact
// deploy pattern. Missing values are surfaced loudly at runtime via
// `console.error` from `runtime-config.ts` instead.

const nextConfig: NextConfig = {
  images: {
    // Bypass the Next.js image optimizer (`/_next/image`). The optimizer
    // requires `sharp` at runtime, which is missing from the Railway image
    // and breaks all `<Image>` rendering site-wide. Our CDN
    // (`cdn.copilotkit.ai`, CloudFront/S3) ignores `?fm=webp` and serves
    // PNG regardless, so the optimizer added no format-conversion value
    // for CDN-hosted images. With `unoptimized`, `<Image>` renders as a
    // plain `<img>` pointing at the source URL — visually identical for
    // users, no sharp dependency required.
    unoptimized: true,
    // Asset CDN for framework intro-page media (banner videos, architecture
    // diagrams, supported-feature thumbnails, framework icons). Hosts every
    // image/video referenced by `src/data/frameworks/*.ts` and any future
    // marketing surface that pulls from the shared CDN. Kept here for
    // documentation and to remain valid if the optimizer is re-enabled.
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
        // Fumadocs LLM page-actions feature: every docs page is also
        // reachable as `<path>.mdx` so LLMCopyButton/ViewOptionsPopover
        // (and external crawlers) can fetch the raw MDX source. The
        // route handler at `app/llms-mdx/[[...slug]]/route.ts` reuses
        // `loadDoc()` to resolve the same content tree the page uses.
        {
          source: "/:path*.mdx",
          destination: "/llms-mdx/:path*",
        },
        {
          source: "/:path*.md",
          destination: "/llms-mdx/:path*",
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
        destination: "/",
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
      // Old guide now belongs in the v2 hook reference.
      {
        source: "/copilot-suggestions",
        destination: "/reference/v2/hooks/useSuggestions",
        permanent: true,
      },
      // AI-slop placeholder pulled from nav until properly authored;
      // file stays on disk for rewrite.
      {
        source: "/generative-ui/open-json-ui",
        destination: "/generative-ui",
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

      // Root `/generative-ui/your-components/*` pages do not exist in
      // the unscoped docs tree, so keep those bare redirects. Do not
      // redirect `/:framework/generative-ui/your-components/*`: several
      // framework-scoped docs, including Built-in Agent, are authored at
      // those paths and should render directly.
      {
        source: "/generative-ui/your-components/display-only",
        destination: "/generative-ui/tool-based",
        permanent: false,
      },
      {
        source: "/generative-ui/your-components/interactive",
        destination: "/human-in-the-loop",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
