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
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
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
  type NavNode,
} from "@/lib/docs-render";
import {
  getDocsFolder,
  getIntegration,
  getIntegrations,
  type Integration,
} from "@/lib/registry";
import { RESERVED_ROUTE_SLUGS } from "@/app/layout";
import demoContent from "@/data/demo-content.json";

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
 * block is inserted as a labeled section right after "App Control" in
 * the root ordering — this mirrors upstream's `integrations/built-in-agent/
 * meta.json`, which puts BIA-specific topics immediately after App
 * Control (before Backend / Premium / Troubleshooting). Implementation:
 * locate the "App Control" section and insert at the next section
 * boundary. Fallbacks in order: insert before "Threads", "Backend", or
 * append at the end.
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
  const appControlIdx = rootNav.findIndex((n) => isSection(n, "app control"));
  let insertAt = -1;
  if (appControlIdx !== -1) {
    // Find the next section after App Control; insert right before it
    // so the override block lands between App Control's pages and
    // whatever comes next.
    for (let i = appControlIdx + 1; i < rootNav.length; i++) {
      if (rootNav[i].type === "section") {
        insertAt = i;
        break;
      }
    }
  }
  if (insertAt === -1) {
    insertAt = rootNav.findIndex((n) => isSection(n, "threads"));
  }
  if (insertAt === -1) {
    insertAt = rootNav.findIndex((n) => isSection(n, "backend"));
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
  let doc = loadDoc(slugPath);
  if (!doc) {
    const fallbackPath = `integrations/${docsFolder}/${slugPath}`;
    doc = loadDoc(fallbackPath);
    if (doc) contentSlugPath = fallbackPath;
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

  const backLink = { label: "\u2190 All docs", href: "/" };

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
            })}{" "}
            instead, or browse the{" "}
            <Link
              href={`/${slugPath}`}
              className="text-[var(--accent)] hover:underline"
            >
              framework-agnostic version
            </Link>
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
      sidebarTitle="CopilotKit Docs"
      backLink={backLink}
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
    <div className="flex" style={{ height: "calc(100vh - 53px)" }}>
      <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <Link
          href="/"
          className="block text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-3 transition-colors"
        >
          ← All docs
        </Link>
        <Link
          href={`/${framework}`}
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4"
        >
          {integration.name}
        </Link>
        {tree.map((node, i) => (
          <RenderNav key={i} node={node} framework={framework} />
        ))}
      </aside>

      {/* <main> is the full-width scroll container so the scrollbar
       * lands at the viewport edge. Content width is capped by the
       * inner wrapper. Previously `max-w-3xl` sat on <main> directly,
       * which parked the scrollbar mid-page. */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-8 py-8">
          <div className="flex items-center gap-3 mb-6">
            {integration.logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={integration.logo} alt="" className="w-10 h-10" />
            )}
            <h1 className="text-[2rem] font-bold text-[var(--text)] tracking-tight">
              {integration.name}
            </h1>
          </div>

          <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-8">
            {integration.description}
          </p>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-4 mb-6">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
              You're viewing docs scoped to
            </div>
            <div className="text-sm font-medium text-[var(--text)]">
              {integration.name}
            </div>
            <p className="text-[13px] text-[var(--text-muted)] mt-2 leading-relaxed">
              Every code snippet on these pages is pulled from the live{" "}
              <code>{framework}</code> cells. Pick a topic from the sidebar to
              start reading.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <LandingCard
              href={`/${framework}/agentic-chat-ui`}
              title="Chat UI"
              desc="Pre-built chat components wired to the agent"
            />
            <LandingCard
              href={`/${framework}/generative-ui/tool-rendering`}
              title="Tool Rendering"
              desc="Render agent tool calls as UI components"
            />
            <LandingCard
              href={`/${framework}/frontend-tools`}
              title="Frontend Tools"
              desc="Expose client-side actions to the agent"
            />
            <LandingCard
              href={`/${framework}/human-in-the-loop`}
              title="Human-in-the-Loop"
              desc="Intercept tool calls for approval"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function LandingCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="group p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
    >
      <div className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
        {title}
      </div>
      <div className="text-xs text-[var(--text-muted)]">{desc}</div>
    </Link>
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
    <div className="flex" style={{ height: "calc(100vh - 53px)" }}>
      <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <Link
          href="/"
          className="block text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-3 transition-colors"
        >
          ← All docs
        </Link>
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
      <div
        className="py-[5px] text-[13px] font-medium text-[var(--text-secondary)]"
        style={{ paddingLeft: `${indent}px` }}
      >
        {node.title}
      </div>
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
