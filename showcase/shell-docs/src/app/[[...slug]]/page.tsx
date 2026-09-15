// /<...slug> — the root docs entry point.
//
// The Built-in Agent (the default framework) is served at the root
// surface: the bare `/` renders the docs overview with the BIA sidebar,
// and `/<slug>` URLs resolve BIA-authored pages first (see
// UnscopedDocsPage). Other frameworks remain at `/<framework>/<slug>`.

import type { Metadata } from "next";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { DocsSetupWizard } from "@/components/docs-setup-wizard";
import { DocsVideoCarousel } from "@/components/docs-video-carousel";
import { HeroOnboardingPromptButton } from "@/components/hero-onboarding-prompt-button";
import { HeroQuickstartDropdown } from "@/components/hero-quickstart-dropdown";
import { ArrowRight } from "lucide-react";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import {
  buildFrameworkNav,
  buildRootSurfaceNav,
  loadDoc,
} from "@/lib/docs-render";
import { compareByDisplayOrder } from "@/lib/framework-order";
import { visibleIntegrations } from "@/lib/homepage-map";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
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
      title: "CopilotKit: bring your agent into any app",
      description:
        "CopilotKit is an open-source framework that connects your app to AI agents. Add chat, interactive UI, and human approvals, with your choice of any agent backend.",
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
  const quickstartOptions = visibleIntegrations()
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
      <div className="docs-inner-content mx-auto pb-12">
        <div className="mx-auto max-w-[900px]">
          <section
            id="copilotkit-intro"
            className="scroll-mt-24 xl:scroll-mt-8 pb-8 pt-2 sm:pb-10"
          >
            <p className="mb-5 text-sm font-semibold text-[var(--accent)]">
              CopilotKit
            </p>
            <h1 className="max-w-[16ch] text-[2.75rem] font-semibold leading-[1.08] tracking-[-0.045em] text-[var(--text)] sm:text-[3.75rem]">
              Bring your agent
              <br />
              <span className="text-[var(--accent)]">into any app</span>
            </h1>
            <p className="mt-6 max-w-[54ch] text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              CopilotKit is an open-source framework that connects your app to
              AI agents. Add chat, interactive UI, and human approvals, with
              your choice of any agent backend.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <HeroOnboardingPromptButton surface="docs_landing_hero" />
              <HeroQuickstartDropdown options={quickstartOptions} />
            </div>
          </section>

          <DocsVideoCarousel />

          <section
            id="setup"
            aria-labelledby="setup-heading"
            className="my-12 scroll-mt-24 xl:scroll-mt-8 sm:my-14"
          >
            <div className="mb-7 flex flex-col gap-3">
              <h2
                id="setup-heading"
                className="shrink-0 text-[1.75rem] font-semibold leading-tight tracking-[-0.035em] text-[var(--text)] sm:text-[2rem]"
              >
                Start building
              </h2>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Start fresh or add to your existing app. Answer a few questions,
                then give the setup prompt to your coding agent.
              </p>
            </div>
            <DocsSetupWizard />
          </section>

          <DocsLandingNext />

          <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-6 text-sm sm:mt-16">
            <a
              href="https://github.com/CopilotKit/CopilotKit"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--text)] hover:underline underline-offset-4"
            >
              View on GitHub
            </a>
            <a
              href="#setup"
              className="inline-flex items-center gap-2 font-medium text-[var(--accent)] hover:underline underline-offset-4"
            >
              Start building{" "}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </footer>
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
