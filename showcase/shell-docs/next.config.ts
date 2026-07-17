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
      // The BIA index.mdx is reachable through the content fallback as
      // `/index`, which would duplicate the home page under a second
      // URL. Canonicalize it to the root.
      {
        source: "/index",
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
      {
        source: "/guides/backend-actions/remote-backend-endpoint",
        destination: "/backend/remote-backends",
        permanent: true,
      },
      // /unselected/* tree retired. Files moved to integrations/built-in-agent/
      // (BIA replaced the old "unselected" slot as the default integration).
      // The Built-in Agent docs are served at the ROOT surface (no
      // framework prefix), so per-path entries below map directly onto
      // root URLs (direct moves + slug renames from SUBPATH_RENAMES in
      // seo-redirects.ts); the catch-all at the bottom routes everything
      // else to the root to preserve SEO equity, since these legacy URLs
      // historically served BIA content.
      {
        source: "/unselected",
        destination: "/",
        permanent: true,
      },
      {
        source: "/unselected/quickstart",
        destination: "/quickstart",
        permanent: true,
      },
      {
        source: "/unselected/advanced-configuration",
        destination: "/advanced-configuration",
        permanent: true,
      },
      {
        source: "/unselected/mcp-servers",
        destination: "/mcp-servers",
        permanent: true,
      },
      {
        source: "/unselected/model-selection",
        destination: "/model-selection",
        permanent: true,
      },
      {
        source: "/unselected/server-tools",
        destination: "/server-tools",
        permanent: true,
      },
      {
        source: "/unselected/shared-state",
        destination: "/shared-state",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/mcp-apps",
        destination: "/generative-ui/mcp-apps",
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
      // copy (240 lines, missing 5 sections) was retired; redirect all
      // historical paths, including the bare root URL the BIA sidebar's
      // Backend section links to.
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
      {
        source: "/custom-agent",
        destination: "/backend/custom-agent",
        permanent: true,
      },

      // ----------------------------------------------------------------
      // Built-in Agent served at the root: /built-in-agent/<page> moved
      // to /<page>. Specific entries first (they must win over the
      // catch-all), then the catch-all that strips the prefix.
      // ----------------------------------------------------------------
      // BIA's AG-UI backend page lives at /backend/ag-ui at the root —
      // the bare /ag-ui segment is owned by the AG-UI protocol docs
      // (src/app/ag-ui/), so the page can't keep its old slug.
      {
        source: "/built-in-agent/ag-ui",
        destination: "/backend/ag-ui",
        permanent: true,
      },
      // Tutorials are retired (see /tutorials/:path* below). Preserve the
      // old middleware behavior of sending framework-scoped tutorial URLs
      // to the quickstart rather than bouncing them through /tutorials → /.
      {
        source: "/built-in-agent/tutorials/:path*",
        destination: "/quickstart",
        permanent: true,
      },
      {
        source: "/built-in-agent/:path*",
        destination: "/:path*",
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
      // agent-app-context now has a root home: the BIA-authored page is
      // served at the bare URL.
      {
        source: "/unselected/agent-app-context",
        destination: "/agent-app-context",
        permanent: true,
      },
      // Slug-rename entries (mirror SUBPATH_RENAMES in seo-redirects.ts).
      // These MUST come before the catch-all so the rename wins. Each
      // historical slug under /unselected/ has been renamed at the root
      // BIA surface; e.g. agentic-chat-ui → prebuilt-components.
      {
        source: "/unselected/agentic-chat-ui",
        destination: "/prebuilt-components",
        permanent: true,
      },
      {
        source: "/unselected/use-agent-hook",
        destination: "/programmatic-control",
        permanent: true,
      },
      {
        source: "/unselected/frontend-actions",
        destination: "/frontend-tools",
        permanent: true,
      },
      // No coding-agents page exists any more; match the root-level
      // R19 (/vibe-coding-mcp) and R18 (/mcp) rules in seo-redirects.ts.
      {
        source: "/unselected/vibe-coding-mcp",
        destination: "/build-with-agents",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/agentic",
        destination: "/generative-ui/your-components/display-only",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/backend-tools",
        destination: "/generative-ui/tool-rendering",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/frontend-tools",
        destination: "/frontend-tools",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/render-only",
        destination: "/generative-ui/your-components/display-only",
        permanent: true,
      },
      {
        source: "/unselected/generative-ui/tool-based",
        destination: "/generative-ui/tool-rendering",
        permanent: true,
      },
      {
        source: "/unselected/custom-look-and-feel/bring-your-own-components",
        destination: "/custom-look-and-feel/slots",
        permanent: true,
      },
      {
        source:
          "/unselected/custom-look-and-feel/customize-built-in-ui-components",
        destination: "/custom-look-and-feel/slots",
        permanent: true,
      },
      {
        source: "/unselected/custom-look-and-feel/markdown-rendering",
        destination: "/custom-look-and-feel/slots",
        permanent: true,
      },
      // The /guides tree no longer exists anywhere (the old destination
      // 404'd through the BIA route); send readers home instead.
      {
        source: "/unselected/guide",
        destination: "/",
        permanent: true,
      },
      {
        source: "/unselected/mcp",
        destination: "/build-with-agents",
        permanent: true,
      },
      // Catch-all: route remaining /unselected/* paths to the root.
      // BIA is the canonical owner of the legacy unselected/ content
      // tree, and BIA is served at the root; matches P1×unselected in
      // seo-redirects.ts.
      {
        source: "/unselected/:path*",
        destination: "/:path*",
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

      // No bare redirects for `/generative-ui/your-components/*`: the
      // Built-in Agent docs are served at the root, and BIA authors real
      // pages at those paths (display-only, interactive). Framework-scoped
      // variants (`/:framework/generative-ui/your-components/*`) also
      // render directly.

      // "Bots SDK" renamed to "Channels SDK" (OSS-438): docs moved from /bots to
      // /channels and /reference/bot to /reference/channels. Preserve links + SEO.
      {
        source: "/bots",
        destination: "/channels",
        permanent: true,
      },
      {
        source: "/bots/:path*",
        destination: "/channels/:path*",
        permanent: true,
      },
      {
        source: "/reference/bot",
        destination: "/reference/channels",
        permanent: true,
      },
      {
        source: "/reference/bot/:path*",
        destination: "/reference/channels/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
