// /<...slug> — the root docs entry point.
//
// The Built-in Agent (the default framework) is served at the root
// surface: the bare `/` renders the docs overview with the BIA sidebar,
// and `/<slug>` URLs resolve BIA-authored pages first (see
// UnscopedDocsPage). Other frameworks remain at `/<framework>/<slug>`.

import type { Metadata } from "next";
import Link from "next/link";
import { DocsSetupWizard } from "@/components/docs-setup-wizard";
import { MapIntro } from "@/components/docs-map-parts";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import {
  buildFrameworkNav,
  buildRootSurfaceNav,
  loadDoc,
} from "@/lib/docs-render";
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
      // Kept in step with the hero copy below. The previous title and
      // description were written against the old "frontend stack for agentic
      // user experience" positioning and named neither Intelligence nor a
      // benefit, so the tab, the search result and the page disagreed.
      title: "CopilotKit: give your app an agent your users can use",
      description:
        "Build chat, generative UI, and approval steps into your React app on any agent framework — then add CopilotKit Intelligence for threads that persist, memory, and agents that learn from real use.",
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

  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[1040px] mx-auto px-4 md:px-6 pt-0 pb-6">
        <section className="relative border-b border-[var(--border)] pb-6 sm:pb-7">
          <div className="flex max-w-[765px] flex-col">
            <div>
              <h1 className="max-w-[24ch] text-[2rem] font-semibold leading-[1.08] tracking-[-0.02em] text-[var(--text)] sm:text-[2.5rem] md:mt-3">
                CopilotKit
              </h1>
              {/* Names a benefit rather than a category. The previous line,
                  "The frontend stack for agentic user experience", is jargon
                  to a first-time reader — it says what shelf the product sits
                  on, not what it does for them. */}
              <p className="mt-3 max-w-[58ch] text-lg font-medium leading-snug text-[var(--text-muted)] sm:text-[1.375rem]">
                Give your app an agent your users can actually use.
              </p>
              <p className="mt-4 max-w-[58ch] text-base leading-[1.55] text-[var(--text-secondary)] sm:text-lg">
                Chat, generative UI, and approval steps inside your own React
                app — connected to whatever agent framework you already run.
              </p>
              {/* Intelligence belongs in the hero: without it, the first
                  answer to "what is this" describes only half the product.
                  Intelligence has no block of its own further down this
                  page — this sentence is what keeps the page honest about
                  the whole product. */}
              <p className="mt-3 max-w-[58ch] text-base leading-[1.55] text-[var(--text-secondary)] sm:text-lg">
                Add{" "}
                <Link
                  href="/intelligence/overview"
                  className="font-medium text-[var(--text)] underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--accent)]"
                >
                  CopilotKit Intelligence
                </Link>{" "}
                when it goes to production: threads that persist, memory, and
                agents that learn from real use.
              </p>
            </div>
          </div>
        </section>

        {/* Placeholder for a product walkthrough video: no such recording
            exists yet, and the only footage on hand today is per-feature
            clips and a partner-page banner, neither of which belongs here.
            Kept deliberately inert — no poster image, no play button — so
            nobody mistakes it for a broken player. Swap this block for a
            real embed once a walkthrough is recorded. */}
        <div
          className="mt-8 flex aspect-video w-full items-center justify-center border border-dashed border-[var(--border)] text-sm text-[var(--text-muted)] shell-docs-radius-surface"
          data-testid="video-placeholder"
        >
          Product walkthrough video coming soon
        </div>

        <div className="pt-8">
          <MapIntro
            heading="Set up CopilotKit for your project"
            body="Answer three quick questions about your frontend, your agent backend, and the features you want. We turn your answers into a prompt — paste it into your coding agent, and it does the setup."
          />
          <DocsSetupWizard />
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
