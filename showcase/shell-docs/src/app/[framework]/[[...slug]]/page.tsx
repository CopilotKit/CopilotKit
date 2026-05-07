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
import { DocsLandingNext } from "@/components/docs-landing-next";
import { DocsPageView } from "@/components/docs-page-view";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
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
function mergeFrameworkNav(
  rootNav: NavNode[],
  overrideNav: NavNode[],
  frameworkName: string,
): NavNode[] {
  if (overrideNav.length === 0) return rootNav;
  const sectionHeader: NavNode = {
    type: "section",
    title: frameworkName,
  };
  const isSection = (n: NavNode, title: string) =>
    n.type === "section" && n.title.toLowerCase() === title.toLowerCase();
  // Section names tried in priority order. The first match wins; the
  // override block is inserted right before the *next* section header
  // after the matched anchor. Update this list when the JTBD section
  // names change in content/docs/meta.json.
  const ANCHOR_CANDIDATES = [
    "give your app agent powers",
    "app control",
    "agents & backends",
    "backend",
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
  if (insertAt === -1) {
    return [...rootNav, sectionHeader, ...overrideNav];
  }
  return [
    ...rootNav.slice(0, insertAt),
    sectionHeader,
    ...overrideNav,
    ...rootNav.slice(insertAt),
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
  const integration = getIntegration(framework);
  if (!integration) {
    const unscopedPath = [framework, ...(slug ?? [])].join("/");
    return <UnscopedDocsPage slugPath={unscopedPath} />;
  }

  const slugPath = slug?.join("/") ?? "";

  // No slug → framework landing page
  if (!slugPath) {
    return <FrameworkLandingPage framework={framework} />;
  }

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
// Framework landing page: renders the docs shell but with an overview
// body derived from the integration's registry metadata.
// ---------------------------------------------------------------------------

function FrameworkLandingPage({ framework }: { framework: string }) {
  const integration = getIntegration(framework);
  if (!integration) notFound();

  // Same nav merge as the scoped-page route. Resolve the URL slug to
  // its docs folder — see comment in FrameworkScopedDocsPage above.
  const rootNav = buildNavTree(CONTENT_DIR);
  const overrideNav = buildFrameworkOverridesNav(getDocsFolder(framework));
  const tree = mergeFrameworkNav(rootNav, overrideNav, integration.name);

  return (
    <div className="flex h-full w-full">
      <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        {tree.map((node, i) => (
          <RenderNav key={i} node={node} framework={framework} />
        ))}
      </aside>

      {/* Same docs-landing shell as `/` (DocsOverview). DocsLandingNext
       * reads the URL-active framework from FrameworkProvider and
       * renders the "Continue with {framework}" branch — Quickstart,
       * Browse docs, Switch framework — instead of the picker. */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl px-8 py-10">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
            Documentation
          </div>
          <h1 className="text-[2.25rem] font-bold text-[var(--text)] tracking-tight mb-3 leading-tight">
            Welcome to CopilotKit
          </h1>
          <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-8 max-w-2xl">
            CopilotKit is the <strong>frontend stack for agents</strong> and{" "}
            <strong>generative UI</strong>. Connect any agent framework or model
            to your React app for chat, generative UI, canvas apps, and
            human-in-the-loop workflows.
          </p>

          <div className="mb-10 max-w-2xl">
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Starting from scratch? Bootstrap a full-stack agent in one
              command:
            </p>
            <pre className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm font-mono overflow-x-auto">
              <code>npx copilotkit@latest create</code>
            </pre>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
            <Link
              href={`/${framework}/concepts/architecture`}
              className="group flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
            >
              <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                Concepts
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Architecture, gen UI types, OSS vs Enterprise.
              </div>
            </Link>
            <Link
              href="/reference"
              className="group flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
            >
              <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                API Reference
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Hooks, components, and config.
              </div>
            </Link>
            <Link
              href={`/${framework}/generative-ui/your-components/display-only`}
              className="group flex flex-col gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 no-underline hover:border-[var(--accent)] hover:shadow-sm transition"
            >
              <div className="font-semibold text-[var(--text)] group-hover:text-[var(--accent)]">
                Generative UI
              </div>
              <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Render tools as React components.
              </div>
            </Link>
          </div>

          <DocsLandingNext />
        </div>
      </main>
    </div>
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
    <div className="flex h-full w-full">
      <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <Link
          href={`/${framework.slug}`}
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4"
        >
          {framework.name}
        </Link>
        {navTree.map((node, i) => (
          <RenderNav key={i} node={node} framework={framework.slug} />
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-8 py-8">
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
              <code>{slugPath}</code> is a topic specific to other integrations.
              Pick one to continue reading:
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
      </main>
    </div>
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
  depth = 0,
}: {
  node: NavNode;
  framework: string;
  depth?: number;
}) {
  const indent = depth * 16;
  if (node.type === "section") {
    return (
      <div
        className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mt-4 mb-2"
        style={{ paddingLeft: `${indent}px` }}
      >
        {node.title}
      </div>
    );
  }
  if (node.type === "page") {
    return (
      <Link
        href={`/${framework}/${node.slug}`}
        className="block py-[5px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        style={{ paddingLeft: `${indent}px` }}
      >
        {node.title}
      </Link>
    );
  }
  return (
    <div className="mt-1">
      {node.title && (
        <div
          className="py-[5px] text-[13px] font-medium text-[var(--text-secondary)]"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
      )}
      {node.children.map((child, i) => (
        <RenderNav
          key={i}
          node={child}
          framework={framework}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
