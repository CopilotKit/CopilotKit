// /<...slug> — the root docs entry point.
//
// The Built-in Agent (the default framework) is served at the root
// surface: the bare `/` renders the docs overview with the BIA sidebar,
// and `/<slug>` URLs resolve BIA-authored pages first (see
// UnscopedDocsPage). Other frameworks remain at `/<framework>/<slug>`.

import React from "react";
import type { Metadata } from "next";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { HeroQuickstartDropdown } from "@/components/hero-quickstart-dropdown";
import {
  HeroStartActions,
  LearnMoreAgentsLink,
} from "@/components/hero-start-commands";
import { LandingSampleTabs } from "@/components/landing-sample-tabs";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import {
  buildFrameworkNav,
  buildRootSurfaceNav,
  loadDoc,
} from "@/lib/docs-render";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";

// Force dynamic rendering so unknown slugs reliably return HTTP 404
// from `notFound()` instead of being cached as a 200 with the not-found
// UI baked in (the search-engine-killing soft-404). The bare home page
// and known unscoped docs are still cheap to render — they're
// filesystem reads of MDX content — and Railway / upstream CDN caches
// successful responses at the edge anyway.
export const dynamic = "force-dynamic";

// Soft-default framework rendered on the bare `/` URL — the same
// framework whose docs are served at the root surface, so the sidebar
// tree on `/` is identical to what the user sees after clicking any
// Built-in Agent sidebar link.
const HOME_DEFAULT_FRAMEWORK = ROOT_FRAMEWORK;

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
  // Root URLs serve the BIA-authored page when one exists (see
  // UnscopedDocsPage) — mirror that resolution for metadata.
  const doc =
    loadDoc(
      `integrations/${getDocsFolder(HOME_DEFAULT_FRAMEWORK)}/${slugPath}`,
    ) ?? loadDoc(slugPath);
  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath,
    ogPath: `/og${canonicalPath}/og.png`,
  });
}

function DocsOverview() {
  // Sidebar matches the soft-default framework so home `/` and the
  // root-served BIA pages share the same authored IA. The empty href
  // prefix serves every sidebar link at the root (`/quickstart`, …);
  // the tree's `index` entry resolves to `/` and gets the active
  // highlight on landing.
  const docsFolder = getDocsFolder(HOME_DEFAULT_FRAMEWORK);
  const integrationName =
    getIntegration(HOME_DEFAULT_FRAMEWORK)?.name ?? "Built-in Agent";
  // Same unified root-surface sidebar every other root page uses, so the
  // sidebar is stable from the home page into any doc.
  const navTree =
    getDocsMode(HOME_DEFAULT_FRAMEWORK) === "authored"
      ? buildRootSurfaceNav(docsFolder)
      : buildFrameworkNav(docsFolder, integrationName, HOME_DEFAULT_FRAMEWORK);
  const pageTree = navTreeToPageTree(navTree, "");

  // The home hero has no framework context, so its quickstart CTA is the
  // framework picker dropdown (same accent treatment as the framework pages'
  // direct quickstart link). The default framework sorts first; its
  // quickstart lives at the root.
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
      href:
        i.slug === HOME_DEFAULT_FRAMEWORK
          ? "/quickstart"
          : `/${i.slug}/quickstart`,
    }));
  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[1040px] mx-auto px-4 md:px-6 pt-0 pb-6">
        <section className="relative border-b border-[var(--border)] pb-6 sm:pb-7">
          <div className="flex max-w-[765px] flex-col">
            <div>
              <h1 className="max-w-[24ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-[var(--text)] sm:text-[2.5rem] md:mt-3">
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
            <div className="mt-7">
              <HeroStartActions
                quickstart={
                  <HeroQuickstartDropdown options={quickstartOptions} />
                }
                trailing={<LearnMoreAgentsLink />}
              />
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
