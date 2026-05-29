// /<...slug> — the framework-agnostic docs entry point.
//
// When a framework is already selected (URL-scoped or from localStorage
// via <RouterPivot>'s useEffect), the user is auto-redirected to
// `/<framework>/<slug>`. Otherwise we render a "pick an agentic
// backend" pivot UI above the page title and hide the MDX body until
// the user chooses one — code without a backend context is incomplete.

import React from "react";
import type { Metadata } from "next";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { HeroCommandCopy } from "@/components/hero-command-copy";
import { HeroQuickstartDropdown } from "@/components/hero-quickstart-dropdown";
import { LandingSampleTabs } from "@/components/landing-sample-tabs";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import {
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  loadDoc,
} from "@/lib/docs-render";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  getIntegrations,
} from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";

// Force dynamic rendering so unknown slugs reliably return HTTP 404
// from `notFound()` instead of being cached as a 200 with the not-found
// UI baked in (the search-engine-killing soft-404). The bare home page
// and known unscoped docs are still cheap to render — they're
// filesystem reads of MDX content — and Railway / upstream CDN caches
// successful responses at the edge anyway.
export const dynamic = "force-dynamic";

// Soft-default framework rendered on the bare `/` URL. Hardcoding BIA
// here keeps the sidebar tree on `/` identical to what the user sees
// after clicking any Built-in Agent sidebar link.
const HOME_DEFAULT_FRAMEWORK = "built-in-agent";
const CREATE_COMMAND = "npx copilotkit@latest create";

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
  // Sidebar matches the soft-default framework so home `/` and
  // post-click `/built-in-agent/...` views share the same authored IA.
  const docsFolder = getDocsFolder(HOME_DEFAULT_FRAMEWORK);
  const integrationName =
    getIntegration(HOME_DEFAULT_FRAMEWORK)?.name ?? "Built-in Agent";
  const navTree =
    getDocsMode(HOME_DEFAULT_FRAMEWORK) === "authored"
      ? buildFrameworkOnlyNav(docsFolder)
      : buildFrameworkNav(docsFolder, integrationName, HOME_DEFAULT_FRAMEWORK);
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
  const quickstartOptions = getIntegrations()
    .filter((i) => getDocsMode(i.slug) !== "hidden")
    .slice()
    .sort((a, b) => {
      if (a.slug === HOME_DEFAULT_FRAMEWORK) return -1;
      if (b.slug === HOME_DEFAULT_FRAMEWORK) return 1;
      return compareByDisplayOrder(a.slug, b.slug);
    })
    .map((i) => ({
      slug: i.slug,
      name: i.slug === HOME_DEFAULT_FRAMEWORK ? "CopilotKit (Default)" : i.name,
      logo: i.logo ?? null,
      href: `/${i.slug}/quickstart`,
    }));

  return (
    <ShellDocsLayout tree={homePageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[1040px] mx-auto px-4 md:px-6 pt-0 pb-6">
        <section className="relative border-b border-[var(--border)] pb-6 sm:pb-7">
          <div className="flex max-w-[765px] flex-col">
            <div>
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)]">
                  <FrameworkLogo
                    slug={HOME_DEFAULT_FRAMEWORK}
                    className="h-5 w-5"
                  />
                </div>
                <span className="text-sm font-semibold tracking-tight text-[var(--text)] sm:text-base">
                  Documentation
                </span>
              </div>
              <h1 className="max-w-[24ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-[var(--text)] sm:text-[2.5rem]">
                CopilotKit
              </h1>
              <p className="mt-3 max-w-[58ch] text-lg font-medium leading-snug text-[var(--text-muted)] sm:text-[1.375rem]">
                The frontend stack for agentic user experience.
              </p>
              <p className="mt-4 max-w-[58ch] text-base leading-[1.55] text-[var(--text-secondary)] sm:text-lg">
                Build production chat, generative UI, shared state, and
                human-in-the-loop workflows on any AG-UI compatible backend.
              </p>
            </div>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <HeroQuickstartDropdown options={quickstartOptions} />
              <HeroCommandCopy command={CREATE_COMMAND} />
            </div>
          </div>
        </section>

        <div className="space-y-10 pt-8">
          <LandingSampleTabs />
          <DocsLandingNext />
        </div>
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
