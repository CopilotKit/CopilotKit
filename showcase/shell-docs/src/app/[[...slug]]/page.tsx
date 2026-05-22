// /<...slug> — the framework-agnostic docs entry point.
//
// When a framework is already selected (URL-scoped or from localStorage
// via <RouterPivot>'s useEffect), the user is auto-redirected to
// `/<framework>/<slug>`. Otherwise we render a "pick an agentic
// backend" pivot UI above the page title and hide the MDX body until
// the user chooses one — code without a backend context is incomplete.

import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { buildFrameworkOnlyNav, loadDoc } from "@/lib/docs-render";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { getDocsFolder } from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";

// Force dynamic rendering so unknown slugs reliably return HTTP 404
// from `notFound()` instead of being cached as a 200 with the not-found
// UI baked in (the search-engine-killing soft-404). The bare home page
// and known unscoped docs are still cheap to render — they're
// filesystem reads of MDX content — and Railway / upstream CDN caches
// successful responses at the edge anyway.
export const dynamic = "force-dynamic";

// Soft-default framework rendered on the bare `/` URL. BIA is the
// "Built-in Agent" path and uses `docs_mode: authored`, so its sidebar
// is its own authored tree under `integrations/built-in-agent/`.
// Hardcoding it here keeps the sidebar tree on `/` identical to what
// the user sees after clicking any BIA sidebar link (e.g. /built-in-agent/quickstart),
// instead of showing the unrelated generated all-content tree on `/`
// and then morphing on first navigation.
const HOME_DEFAULT_FRAMEWORK = "built-in-agent";

// Per-framework self-canonical: each variant of a doc page declares
// itself canonical so search engines index every framework's quickstart
// (etc.) at its own URL rather than collapsing them all onto the bare
// /quickstart. Done at the page level so the metadata depends on params.
//
// For the bare home page we hand-wire title/description so visitors and
// social platforms see CopilotKit's positioning rather than the page's
// own first MDX line.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugPath = slug?.join("/") ?? "";
  const canonicalPath = slugPath ? `/${slugPath}` : "/";
  // Home page: brand-level title + tagline. Other unscoped slugs (e.g.
  // /quickstart, /concepts/architecture) read frontmatter via loadDoc.
  if (!slugPath) {
    return buildDocMetadata({
      title: "CopilotKit: the frontend stack for agents",
      description:
        "Connect any agent framework or model to your React app for chat, generative UI, canvas, and human-in-the-loop workflows.",
      canonicalPath: "/",
    });
  }
  const doc = loadDoc(slugPath);
  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath,
    ogPath: `/og${canonicalPath}/og.png`,
  });
}

function DocsOverview() {
  // Sidebar matches the soft-default framework (BIA, `docs_mode: authored`)
  // so the home `/` and the post-click `/built-in-agent/...` views share
  // an identical sidebar tree. Mirrors the `authored`-mode branch in
  // `/<framework>/<...slug>` (page.tsx): `buildFrameworkOnlyNav(docsFolder)`
  // for the tree, `/<framework>` for the link prefix.
  const docsFolder = getDocsFolder(HOME_DEFAULT_FRAMEWORK);
  const navTree = buildFrameworkOnlyNav(docsFolder);
  const pageTree = navTreeToPageTree(navTree, `/${HOME_DEFAULT_FRAMEWORK}`);

  // Rewrite the Introduction entry's URL from `/built-in-agent` (or
  // `/built-in-agent/index`) to `/` so it matches the home-page URL and
  // gets the active highlight on landing. Walk the tree recursively
  // because Fumadocs's PageTree can nest pages inside folders.
  const homeUrlCandidates = new Set([
    `/${HOME_DEFAULT_FRAMEWORK}`,
    `/${HOME_DEFAULT_FRAMEWORK}/`,
    `/${HOME_DEFAULT_FRAMEWORK}/index`,
  ]);
  type PT = (typeof pageTree.children)[number];
  const rewriteUrls = (nodes: readonly PT[]): PT[] =>
    nodes.map((node): PT => {
      if (node.type === "page" && homeUrlCandidates.has(node.url)) {
        return { ...node, url: "/" };
      }
      if (node.type === "folder") {
        const next: typeof node = {
          ...node,
          children: rewriteUrls(node.children) as typeof node.children,
        };
        if (node.index && homeUrlCandidates.has(node.index.url)) {
          next.index = { ...node.index, url: "/" };
        }
        return next;
      }
      return node;
    });
  const homePageTree = {
    ...pageTree,
    children: rewriteUrls(pageTree.children),
  };

  return (
    <ShellDocsLayout tree={homePageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
        {/* Hero — typography-led. No eyebrow pill, no atmospheric glow.
            Title + lede + an unframed `npm install`-style block. */}
        <section className="pt-8 sm:pt-12 pb-8 sm:pb-10">
          <h1 className="text-[2.25rem] sm:text-[2.75rem] font-semibold text-[var(--text)] tracking-tight mb-4 leading-[1.05]">
            Welcome to CopilotKit
          </h1>
          <p className="text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed mb-8 max-w-2xl">
            CopilotKit is the <strong>frontend stack for agents</strong> and{" "}
            <strong>generative UI</strong>. Connect any agent framework or model
            to your React app for chat, generative UI, canvas apps, and
            human-in-the-loop workflows.
          </p>
          <div className="max-w-2xl rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5">
            <code className="font-mono text-sm text-[var(--text)] overflow-x-auto whitespace-nowrap block">
              npx copilotkit@latest create
            </code>
          </div>
        </section>

        {/* ===== PRIMARY NAV GRID ===== */}
        {/* Three top-level docs surfaces. Minimal cards — title, body,
            trailing arrow. Hover changes only the border + arrow color. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-12">
          {[
            {
              href: "/concepts/architecture",
              title: "Concepts",
              body: "Architecture, gen UI types, OSS vs Enterprise.",
            },
            {
              href: "/reference",
              title: "API Reference",
              body: "Hooks, components, and config.",
            },
            {
              href: "/generative-ui/your-components/display-only",
              title: "Generative UI",
              body: "Render tools as React components.",
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-5 no-underline hover:border-[var(--accent)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="font-semibold text-[var(--text)]">
                  {card.title}
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                {card.body}
              </div>
            </Link>
          ))}
        </div>

        {/* Conditional next-step block: framework picker if no
              storedFramework, "what's next" pointers into that
              framework's docs if there is one. */}
        <DocsLandingNext />
      </div>
    </ShellDocsLayout>
  );
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  // Overview page when no slug — the only path this route exclusively owns.
  // All other paths (e.g. /quickstart) are intercepted by [framework] first
  // due to Next.js routing precedence and fall through to UnscopedDocsPage there.
  if (!slug || slug.length === 0) {
    return <DocsOverview />;
  }

  return <UnscopedDocsPage slugPath={slug.join("/")} />;
}
