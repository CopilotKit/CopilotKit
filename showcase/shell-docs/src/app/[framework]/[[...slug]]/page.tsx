// /<framework>/<...slug> — framework-scoped docs route.
//
// Example URLs:
//   /langgraph-python                       → framework landing page
//   /langgraph-python/agentic-chat-ui       → the Agentic Chat UI docs
//                                             with snippets resolved from
//                                             the `langgraph-python`
//                                             integration's cells
//   /mastra/generative-ui/tool-rendering    → tool rendering docs scoped
//                                             to the `mastra` cells
//
// The first URL segment is validated against the registry's list of
// integration slugs. When it doesn't match, we fall through to
// UnscopedDocsPage so unscoped doc slugs (e.g. /quickstart) are served
// correctly even though Next.js routes them here before [[...slug]].

import React from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { DocsPage } from "fumadocs-ui/page";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { DocsPageView } from "@/components/docs-page-view";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { SidebarNav } from "@/components/sidebar-nav";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { FrameworkOverview } from "@/components/content/landing-pages/framework-overview";
import { frameworkOverviews } from "@/data/frameworks";
import { docsComponents } from "@/lib/mdx-registry";
import { transformerMeta } from "@/lib/rehype-code-meta";
import {
  CONTENT_DIR,
  buildFrameworkOverridesNav,
  buildNavTree,
  findFrameworksWithCell,
  findFrameworksWithPage,
  loadDoc,
} from "@/lib/docs-render";
import type { NavNode } from "@/lib/docs-render";
import { getDocsFolder, getIntegration, getIntegrations } from "@/lib/registry";
import type { Integration } from "@/lib/registry";
import { getBaseUrl } from "@/lib/sitemap-helpers";
import { RESERVED_ROUTE_SLUGS } from "@/app/layout";
import demoContent from "@/data/demo-content.json";
import fs from "fs";
import path from "path";

// Per-framework self-canonical: /<framework>/<slug> declares itself
// canonical (NOT the bare /<slug>) so search engines index each
// framework variant at its own URL. When the URL's first segment
// doesn't match a registered integration, the route falls through to
// UnscopedDocsPage but the canonical still points at the same URL —
// the page's identity is defined by its URL, not the resolution
// strategy used to render it.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ framework: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { framework, slug } = await params;
  const slugTail = slug && slug.length > 0 ? `/${slug.join("/")}` : "";
  return {
    alternates: {
      canonical: `${getBaseUrl()}/${framework}${slugTail}`,
    },
  };
}

export async function generateStaticParams() {
  // Rely on the catch-all's dynamic behaviour at runtime; returning an
  // empty array keeps build times short since there are ~17 frameworks
  // × ~60 doc pages, all cheap to render on demand.
  return [];
}

interface DemoRecord {
  regions?: Record<string, unknown>;
}
const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

/**
 * Heuristic: does this framework have ANY region tagged for the given
 * feature slug? Used to render a clear "not available" banner when an
 * MDX page's snippet_cell points at a cell that doesn't exist for the
 * currently selected framework.
 */
function frameworkHasCellFor(framework: string, cell: string): boolean {
  return Boolean(demos[`${framework}::${cell}`]);
}

/**
 * Merge per-framework overrides into the root nav tree. The override
 * block is inserted as a labeled section right after the agent-control
 * section in the root ordering — this mirrors upstream's
 * `integrations/built-in-agent/meta.json`, which puts BIA-specific
 * topics immediately after the App-Control / agent-behavior section.
 *
 * Anchor names are tried in priority order so the merge survives
 * section renames (the JTBD reorg renamed "App Control" → "Give Your
 * App Agent Powers"). Each candidate is matched as a section header;
 * when found, the override block is inserted right before the *next*
 * section, so the framework-unique pages end up sandwiched after the
 * anchor section's own pages.
 *
 * Final fallback: append at the end of the nav.
 */
// Map a framework slug to the section-header icon spec used by the
// sidebar bridge. LangGraph variants (-python, -typescript, -fastapi)
// share the LangGraph mark; other integrations have no custom mark
// yet and fall back to no icon. Extend as we ship more.
function frameworkSectionIcon(framework: string): string | undefined {
  if (/^langgraph/.test(framework)) return "custom/langgraph";
  return undefined;
}

function mergeFrameworkNav(
  rootNav: NavNode[],
  overrideNav: NavNode[],
  frameworkName: string,
  frameworkIcon?: string,
): NavNode[] {
  if (overrideNav.length === 0) return rootNav;

  // Pull the framework-root page (the "Introduction" entry from
  // integrations/<folder>/meta.json's literal "index" slot —
  // buildFrameworkOverridesNav rewrites its slug to "") out of the override
  // nav so we can place it inside the global "Get Started" section instead
  // of stranding it above all section headers as a top-level prefix.
  const introIdx = overrideNav.findIndex(
    (n) => n.type === "page" && n.slug === "",
  );
  const introNode = introIdx >= 0 ? overrideNav[introIdx] : null;
  const remainingOverrideNav =
    introIdx >= 0
      ? [...overrideNav.slice(0, introIdx), ...overrideNav.slice(introIdx + 1)]
      : overrideNav;

  const sectionHeader: NavNode = {
    type: "section",
    title: frameworkName,
    icon: frameworkIcon,
  };
  const isSection = (n: NavNode, title: string) =>
    n.type === "section" && n.title.toLowerCase() === title.toLowerCase();
  // Section names tried in priority order. The first match wins; the
  // override block is inserted right before the *next* section header
  // after the matched anchor. Update this list when the JTBD section
  // names change in content/docs/meta.json. Anchor on "add agent
  // powers" so the framework block lands JUST ABOVE "Runtime" —
  // framework-specific guides sit alongside the agent-powers section
  // they extend, but stay below the foundational Build / Add sections.
  const ANCHOR_CANDIDATES = [
    "add agent powers",
    // Older section names kept as fallbacks so the merge still works
    // if content/docs/meta.json is rolled back mid-refactor.
    "give your app agent powers",
    "app control",
    "agents & backends",
    "backend",
    "runtime",
  ];
  let insertAt = -1;
  for (const anchor of ANCHOR_CANDIDATES) {
    const anchorIdx = rootNav.findIndex((n) => isSection(n, anchor));
    if (anchorIdx === -1) continue;
    for (let i = anchorIdx + 1; i < rootNav.length; i++) {
      if (rootNav[i].type === "section") {
        insertAt = i;
        break;
      }
    }
    if (insertAt !== -1) break;
  }

  // Reconcile the rootNav's existing root-level introduction (the
  // `"index"` entry in content/docs/meta.json, which produces a
  // page-with-slug-"" pointing at `/`) with the framework's own
  // introNode (slug "" pointing at `/<framework>`). At a framework
  // view we want exactly ONE Introduction entry, and it should be the
  // framework-scoped one. Drop the root-level intro and substitute the
  // framework's introNode in its place; otherwise splice the framework
  // introNode into the Get Started section as a fallback.
  const rootHasIntro = rootNav.some((n) => n.type === "page" && n.slug === "");
  const rootNavWithIntro = (() => {
    if (!introNode) return rootNav;
    if (rootHasIntro) {
      return rootNav.map((n) =>
        n.type === "page" && n.slug === "" ? introNode : n,
      );
    }
    const getStartedIdx = rootNav.findIndex((n) => isSection(n, "get started"));
    if (getStartedIdx === -1) return [introNode, ...rootNav];
    return [
      ...rootNav.slice(0, getStartedIdx + 1),
      introNode,
      ...rootNav.slice(getStartedIdx + 1),
    ];
  })();

  if (insertAt === -1) {
    return [...rootNavWithIntro, sectionHeader, ...remainingOverrideNav];
  }
  // `insertAt` was computed against the original rootNav. The replace
  // path (rootHasIntro) preserves array length; only the splice path
  // shifts indices at/after Get Started by +1.
  const getStartedIdx = rootNav.findIndex((n) => isSection(n, "get started"));
  const adjustedInsertAt =
    introNode &&
    !rootHasIntro &&
    getStartedIdx !== -1 &&
    insertAt > getStartedIdx
      ? insertAt + 1
      : insertAt;
  return [
    ...rootNavWithIntro.slice(0, adjustedInsertAt),
    sectionHeader,
    ...remainingOverrideNav,
    ...rootNavWithIntro.slice(adjustedInsertAt),
  ];
}

export default async function FrameworkScopedDocsPage({
  params,
}: {
  params: Promise<{ framework: string; slug?: string[] }>;
}) {
  const { framework, slug } = await params;

  // Defense in depth: explicitly 404 on reserved top-level route slugs.
  // Next.js already prefers exact-match routes over this catch-all, so
  // `/docs`, `/ag-ui`, etc. never reach here during normal routing.
  // But if the registry ever ships an integration whose slug collides
  // with a reserved segment, layout.tsx drops it from knownFrameworks
  // AND this guard ensures the route handler still short-circuits to a
  // clean 404 rather than rendering garbage.
  if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(framework)) {
    notFound();
  }

  // Validate the framework slug against the registry.
  // If not a registered integration, treat the URL as an unscoped doc path.
  // This is necessary because Next.js routes /quickstart here (dynamic segment
  // beats optional catch-all) before [[...slug]] ever sees it.
  //
  // Exception: docs-only frameworks (`a2a`, `agent-spec`, `deepagents`) have a
  // `frameworkOverviews` entry and/or content under `integrations/<slug>/`
  // but no demo package in `showcase/integrations/`, so they're absent from
  // the registry. Recognize them by slug so the framework-root page (Tier 1
  // FrameworkOverview / Tier 2 MDX index) can still render.
  const integration = getIntegration(framework);
  const isDocsOnlyFramework =
    !integration &&
    (frameworkOverviews[framework] !== undefined ||
      fs.existsSync(path.join(CONTENT_DIR, "integrations", framework)));
  if (!integration && !isDocsOnlyFramework) {
    const unscopedPath = [framework, ...(slug ?? [])].join("/");
    return <UnscopedDocsPage slugPath={unscopedPath} />;
  }

  const slugPath = slug?.join("/") ?? "";

  // No slug → framework landing page. Three-tier resolution:
  //   1. Data-driven `FrameworkOverview` when a record exists in
  //      `frameworkOverviews` (13 frameworks).
  //   2. MDX-authored `integrations/<folder>/index.mdx` when present
  //      (built-in-agent + deepagents are fully free-form).
  //   3. Fallback: 404. Every registered integration is expected to
  //      have either a data record OR an index.mdx after Phase 2; a
  //      missing entry is an authoring error worth surfacing.
  if (!slugPath) {
    return <FrameworkRootPage framework={framework} />;
  }

  // Past this point we require a registry integration record. Docs-only
  // frameworks (a2a/agent-spec/deepagents) only support the bare
  // `/<framework>` root URL — scoped subpaths like `/a2a/some-feature`
  // have no demo + no per-framework override, so 404 is the honest
  // answer rather than crashing on `integration.name` below.
  if (!integration) notFound();

  // `/<framework>/unselected/<path>` is incoherent — a framework IS
  // selected, so the URL should never assert the "unselected" state
  // alongside. Collapse to the framework-scoped path (which serves the
  // same underlying content, just with Snippets resolved against the
  // selected framework's cells).
  if (slugPath.startsWith("unselected/")) {
    redirect(`/${framework}/${slugPath.slice("unselected/".length)}`);
  }

  // Content resolution:
  //   1. Root MDX — framework-agnostic page rendered with this
  //      framework's override (Model 1, the primary path).
  //   2. Per-framework override at `integrations/<framework>/<slug>.mdx`
  //      — topics that are genuinely framework-specific (e.g. BIA's
  //      `server-tools`) and have no root equivalent. When this path
  //      wins, we record it as `contentSlugPath` so DocsPageView loads
  //      from there while the URL slug continues driving breadcrumbs
  //      and active-link detection.
  //   3. If the slug exists for *other* frameworks but not this one,
  //      render a "not available for <framework>" fallback inside the
  //      docs shell (handled below, after the nav is built).
  //   4. Otherwise 404.
  // Most registry slugs map 1:1 to a folder under `integrations/`, but
  // language/runtime variants share a single docs folder:
  // langgraph-python/typescript/fastapi → `langgraph/`, ms-agent-dotnet/
  // python → `microsoft-agent-framework/`, plus legacy renames for
  // google-adk → `adk/` and strands → `aws-strands/`. Resolve the URL
  // slug to its docs folder before touching disk.
  const docsFolder = getDocsFolder(framework);

  let contentSlugPath: string = slugPath;
  let doc: ReturnType<typeof loadDoc> = null;

  // `/quickstart` at the root is a routing shim — it exists only so
  // the sidebar's Quickstart entry has a backing page. Real quickstart
  // content lives per-framework at `integrations/<framework>/quickstart.mdx`,
  // so for framework-scoped URLs the override always wins over the shim.
  if (slugPath === "quickstart") {
    const overridePath = `integrations/${docsFolder}/${slugPath}`;
    doc = loadDoc(overridePath);
    if (doc) contentSlugPath = overridePath;
  }

  if (!doc) {
    doc = loadDoc(slugPath);
    if (!doc) {
      const fallbackPath = `integrations/${docsFolder}/${slugPath}`;
      doc = loadDoc(fallbackPath);
      if (doc) contentSlugPath = fallbackPath;
    }
  }

  // Sidebar nav needs to render on both the happy path and the
  // "not available" fallback, so build it before branching.
  const rootNav = buildNavTree(CONTENT_DIR);
  const overrideNav = buildFrameworkOverridesNav(docsFolder);
  const navTree: NavNode[] = mergeFrameworkNav(
    rootNav,
    overrideNav,
    integration.name,
    frameworkSectionIcon(framework),
  );

  if (!doc) {
    // No root MDX and no override for this framework. If the topic
    // exists for *other* frameworks (e.g. a BIA-specific page like
    // `/mastra/advanced-configuration`), render a fallback inside the
    // docs shell that lists the frameworks where it does exist — the
    // user keeps their framework context and gets a clear path
    // forward. Only 404 when the slug is unknown everywhere.
    const allFrameworkSlugs = getIntegrations().map((i) => i.slug);
    const availableIn = findFrameworksWithPage(
      slugPath,
      allFrameworkSlugs,
      getDocsFolder,
    );
    if (availableIn.length > 0) {
      return (
        <NotAvailableForFrameworkPage
          framework={integration}
          slugPath={slugPath}
          availableIn={availableIn}
          navTree={navTree}
        />
      );
    }
    notFound();
  }

  // Detect whether this page's default cell (the feature) has any
  // snippets tagged for the current framework. When it doesn't, show
  // a prominent banner pointing the user at a framework that does.
  const missingCell =
    doc.fm.defaultCell && !frameworkHasCellFor(framework, doc.fm.defaultCell);
  const alternativeFrameworks = doc.fm.defaultCell
    ? findFrameworksWithCell(
        doc.fm.defaultCell,
        getIntegrations().map((i) => i.slug),
        demos,
      )
    : [];

  const banner = missingCell ? (
    <div className="mb-6 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4">
      <div className="text-sm font-semibold text-[var(--text)] mb-1">
        Not available for {integration.name} yet
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
        This feature (<code>{doc.fm.defaultCell}</code>) hasn't been tagged in
        any {integration.name} cell yet.
        {alternativeFrameworks.length > 0 && (
          <>
            {" "}
            Try{" "}
            {alternativeFrameworks.slice(0, 3).map((slug, i) => {
              const alt = getIntegration(slug);
              if (!alt) return null;
              const name = alt.name;
              const href = `/${slug}/${slugPath}`;
              return (
                <React.Fragment key={slug}>
                  {i > 0 && ", "}
                  <Link
                    href={href}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {name}
                  </Link>
                </React.Fragment>
              );
            })}
            .
          </>
        )}
      </p>
    </div>
  ) : null;

  return (
    <DocsPageView
      slugPath={slugPath}
      contentSlugPath={contentSlugPath}
      slugHrefPrefix={`/${framework}`}
      frameworkOverride={framework}
      navTree={navTree}
      bannerSlot={banner}
    />
  );
}

// ---------------------------------------------------------------------------
// Framework root page: renders the docs shell at the bare `/<framework>`
// URL using one of three content sources, tried in order:
//
//   Tier 1. Data-driven `FrameworkOverview` from `frameworkOverviews`
//           (13 frameworks). Optionally augmented with an after-features
//           MDX escape hatch loaded from
//           `src/content/framework-overviews/<slug>/after-features.mdx`.
//   Tier 2. Free-form `integrations/<folder>/index.mdx`, rendered
//           through the standard MDX pipeline. Used by built-in-agent
//           and deepagents, which don't fit the FrameworkOverview shape.
//   Tier 3. 404 — every registered integration should resolve via Tier
//           1 or Tier 2. A missing record + missing MDX is an authoring
//           error.
//
// The sidebar / framework-selector chrome is identical to the per-doc
// `DocsPageView` rendering so the framework-root URL reads as part of
// the docs surface rather than a separate landing.
// ---------------------------------------------------------------------------

const FRAMEWORK_OVERVIEW_MDX_DIR = path.join(
  process.cwd(),
  "src/content/framework-overviews",
);

async function FrameworkRootPage({ framework }: { framework: string }) {
  // Some frameworks are docs-only — they have a `frameworkOverviews`
  // entry and an `integrations/<slug>/` content folder, but no demo
  // package in `showcase/integrations/`, so `getIntegration()` returns
  // undefined. Don't bail here — fall back to slug-derived inputs and
  // let the Tier 1/2/3 cascade below decide whether to render or 404.
  const integration = getIntegration(framework);

  // Same nav merge as the scoped-page route. Resolve the URL slug to
  // its docs folder — see comment in FrameworkScopedDocsPage above.
  // `getDocsFolder` already falls back to the slug itself when there's
  // no override, so it's safe for docs-only frameworks.
  const docsFolder = getDocsFolder(framework);
  const rootNav = buildNavTree(CONTENT_DIR);
  const overrideNav = buildFrameworkOverridesNav(docsFolder);
  // Display name preference: integration record → overview data →
  // raw slug. `mergeFrameworkNav` uses this purely as the section
  // header text inserted into the sidebar.
  const integrationName =
    integration?.name ??
    frameworkOverviews[framework]?.frameworkName ??
    framework;
  const navTree = mergeFrameworkNav(
    rootNav,
    overrideNav,
    integrationName,
    frameworkSectionIcon(framework),
  );

  // Tier 1: data-driven FrameworkOverview.
  const overview = frameworkOverviews[framework];
  if (overview) {
    let afterFeatures: React.ReactNode = undefined;
    if (overview.hasAfterFeaturesMdx) {
      const mdxPath = path.join(
        FRAMEWORK_OVERVIEW_MDX_DIR,
        framework,
        "after-features.mdx",
      );
      if (fs.existsSync(mdxPath)) {
        try {
          const raw = fs.readFileSync(mdxPath, "utf-8");
          afterFeatures = (
            <MDXRemote
              source={raw}
              components={{
                ...docsComponents,
                // Mirror DocsPageView: wrap MDX-rendered <pre> blocks
                // with figure chrome (copy button + optional file-path
                // caption) so fenced code in after-features.mdx has the
                // same affordances as fenced code on a regular docs
                // page. `rehypeCodeMeta` (below) supplies the
                // `data-title` / `data-language` data-attrs MdxCodeBlock
                // reads.
                pre: MdxCodeBlock,
              }}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                  // Fumadocs's Shiki-based `rehypeCode`; our
                  // `transformerMeta` Shiki transformer surfaces fence
                  // `title="..."` and the resolved language as data-attrs
                  // on the <pre> so MdxCodeBlock can render Fumadocs's
                  // CodeBlock figcaption + copy button.
                  rehypePlugins: [
                    [
                      rehypeCode,
                      {
                        fallbackLanguage: "plaintext",
                        transformers: [
                          ...(rehypeCodeDefaultOptions.transformers ?? []),
                          transformerMeta(),
                        ],
                      },
                    ],
                  ],
                },
              }}
            />
          );
        } catch (err) {
          // Logged + swallowed: FrameworkOverview falls back to the
          // structured `data.cta` block when `afterFeatures` is empty,
          // so a transient read failure doesn't blank the page.
          console.error(
            `[framework-root] failed to read after-features.mdx for ${framework}`,
            err,
          );
        }
      } else {
        console.error(
          `[framework-root] hasAfterFeaturesMdx=true but file is missing: ${mdxPath}`,
        );
      }
    }
    return (
      <FrameworkRootShell framework={framework} navTree={navTree}>
        <FrameworkOverview
          data={overview}
          currentFramework={framework}
          afterFeatures={afterFeatures}
        />
      </FrameworkRootShell>
    );
  }

  // Tier 2: free-form `integrations/<folder>/index.mdx`. Delegate to
  // `DocsPageView` so the MDX renders through the same component map
  // (Callout, Cards, OpsPlatformCTA, …) used by every other docs page.
  // `slugPath=""` keeps active-link logic pointing at the framework
  // root (the new `"index"`→`""` rewrite in buildFrameworkOverridesNav
  // matches this).
  const indexContentPath = `integrations/${docsFolder}/index`;
  if (loadDoc(indexContentPath)) {
    return (
      <DocsPageView
        slugPath=""
        contentSlugPath={indexContentPath}
        slugHrefPrefix={`/${framework}`}
        frameworkOverride={framework}
        navTree={navTree}
      />
    );
  }

  // Tier 3: no data record AND no MDX index. Authoring gap.
  notFound();
}

/**
 * Sidebar + content-wrapper chrome shared with `DocsPageView`. Used by
 * Tier 1 (data-driven FrameworkOverview) only; Tier 2 delegates to
 * `DocsPageView` directly.
 */
function FrameworkRootShell({
  framework,
  navTree,
  children,
}: {
  framework: string;
  navTree: NavNode[];
  children: React.ReactNode;
}) {
  // slugHrefPrefix is `/<framework>` so every sidebar link resolves
  // inside the framework scope.
  const pageTree = navTreeToPageTree(navTree, `/${framework}`);
  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
          {children}
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}

// ---------------------------------------------------------------------------
// "Not available for this framework" fallback. Rendered when the URL's
// slug has no root MDX, no override for the URL's framework, but DOES
// exist for one or more other frameworks (typically a BIA-specific
// page being hit under a different integration's scope). The goal is
// to keep the user in context — sidebar intact, framework switcher
// reachable — while pointing them at the frameworks where the page
// actually exists.
// ---------------------------------------------------------------------------

function NotAvailableForFrameworkPage({
  framework,
  slugPath,
  availableIn,
  navTree,
}: {
  framework: Integration;
  slugPath: string;
  availableIn: string[];
  navTree: NavNode[];
}) {
  const title = humanizeSlug(slugPath);
  return (
    <>
      <SidebarNav className="hidden md:flex flex-col w-[260px] shrink-0 rounded-l-2xl backdrop-blur-lg border border-r-0 border-[var(--border)] bg-[var(--glass-background)] overflow-hidden px-3">
        <SidebarFrameworkSelector />
        <Link
          href={`/${framework.slug}`}
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4 px-3"
        >
          {framework.name}
        </Link>
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {navTree.map((node, i) => (
            <RenderNav
              key={i}
              node={node}
              framework={framework.slug}
              slugPath={slugPath}
            />
          ))}
        </div>
      </SidebarNav>

      <div className="docs-content-wrapper flex">
        <div className="flex-1 min-w-0 px-4 py-6 md:px-6 md:pt-8 xl:px-8 xl:pt-14">
          <div className="max-w-[900px] mx-auto">
            <h1 className="text-[2rem] font-bold text-[var(--text)] tracking-tight mb-2 leading-tight">
              {title}
            </h1>
            <p className="text-base text-[var(--text-muted)] mb-6 leading-relaxed">
              This topic isn't available for {framework.name}.
            </p>
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-5 mb-6">
              <div className="text-sm font-semibold text-[var(--text)] mb-2">
                Available in other integrations
              </div>
              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-3">
                <code>{slugPath}</code> is a topic specific to other
                integrations. Pick one to continue reading:
              </p>
              <ul className="space-y-2">
                {availableIn.map((slug) => {
                  const alt = getIntegration(slug);
                  if (!alt) return null;
                  return (
                    <li key={slug}>
                      <Link
                        href={`/${slug}/${slugPath}`}
                        className="text-sm text-[var(--accent)] hover:underline"
                      >
                        {alt.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
            <p className="text-[13px] text-[var(--text-muted)]">
              Or return to{" "}
              <Link
                href={`/${framework.slug}`}
                className="text-[var(--accent)] hover:underline"
              >
                the {framework.name} docs
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function humanizeSlug(slugPath: string): string {
  const last = slugPath.split("/").pop() ?? slugPath;
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function RenderNav({
  node,
  framework,
  slugPath = "",
  depth = 0,
}: {
  node: NavNode;
  framework: string;
  /** Current URL slug under `/<framework>/…`, used for active-state. */
  slugPath?: string;
  depth?: number;
}) {
  if (node.type === "section") {
    if (depth > 0) {
      return (
        <div className="px-3 mt-4 mb-1 text-[11px] uppercase tracking-wide text-[var(--text-faint)]">
          {node.title}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 mt-6 mb-3">
        <span className="text-[15px] uppercase tracking-wide shrink-0 text-[var(--text-secondary)]">
          {node.title}
        </span>
        <div className="flex-1 h-px bg-[var(--border)]" />
      </div>
    );
  }
  if (node.type === "page") {
    // Empty slug = framework-root entry (the `"index"` meta.json
    // sentinel rewritten by buildFrameworkOverridesNav). Link to the
    // bare `/<framework>` URL; active when slugPath is also empty.
    const href = node.slug ? `/${framework}/${node.slug}` : `/${framework}`;
    const isActive = node.slug === slugPath;
    return (
      <Link
        href={href}
        className={`flex items-center h-10 px-3 text-sm rounded-lg shrink-0 transition-all duration-200 ${
          isActive
            ? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm dark:bg-[var(--bg-hover)] dark:shadow-none dark:ring-1 dark:ring-white/10"
            : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]/60 hover:text-[var(--text)] dark:hover:bg-white/5"
        }`}
      >
        {node.title}
      </Link>
    );
  }
  // Group: a labeled folder with nested children. Title-less wrapper
  // groups (used to flatten a section's content) skip the indent and
  // tree-line so their children render at the parent's depth.
  const hasTitle = !!node.title;
  return (
    <div className="mt-1">
      {hasTitle && (
        <div className="flex items-center h-10 px-3 text-sm font-medium text-[var(--text)] shrink-0">
          {node.title}
        </div>
      )}
      <div
        className={
          hasTitle
            ? "ml-3 pl-3 border-l border-[var(--border-dim)] flex flex-col"
            : "flex flex-col"
        }
      >
        {node.children.map((child, i) => (
          <RenderNav
            key={i}
            node={child}
            framework={framework}
            slugPath={slugPath}
            depth={depth + 1}
          />
        ))}
      </div>
    </div>
  );
}
