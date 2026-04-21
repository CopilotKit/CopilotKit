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
// integration slugs. When it doesn't match, we return 404 — the only
// top-level routes that shadow this catch-all are the existing ones
// (`/docs`, `/integrations`, `/ag-ui`, `/reference`, `/api`, `/matrix`),
// none of which are framework slugs, so there are no collisions.

import React from "react";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { DocsPageView } from "@/components/docs-page-view";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import {
  CONTENT_DIR,
  buildNavTree,
  findFrameworksWithCell,
  loadDoc,
  type NavNode,
} from "@/lib/docs-render";
import { getIntegration, getIntegrations } from "@/lib/registry";
import { RESERVED_ROUTE_SLUGS } from "@/app/layout";
import demoContent from "@/data/demo-content.json";

// Route cannot be statically exported: generateStaticParams returns [] and
// Next.js' default `dynamicParams=true` is what makes runtime rendering
// work for every framework + slug. Declare it explicitly so a future
// migration to `output: "export"` fails loudly here (dynamicParams must
// be false under static export, which would surface immediately) rather
// than silently 404ing every `/<framework>/<slug>` URL.
export const dynamicParams = true;

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

  // Validate the framework slug against the registry. Anything else
  // falls through to 404 — Next.js top-level routes (`/docs`, etc.)
  // take precedence over the catch-all automatically.
  const integration = getIntegration(framework);
  if (!integration) notFound();

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

  // When the page doesn't exist at all, 404.
  const doc = loadDoc(slugPath);
  if (!doc) notFound();

  const backLink = { label: "\u2190 All docs", href: "/docs" };
  const navTree = buildNavTree(CONTENT_DIR);

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
            {alternativeFrameworks
              // Filter out any slug that doesn't resolve to a registered
              // integration BEFORE mapping to fragments — otherwise the
              // comma separator (`i > 0 && ", "`) is emitted against the
              // pre-filter index, producing a stray leading or double
              // comma when a slug drops out mid-sequence.
              .map((slug) => getIntegration(slug))
              .filter(
                (alt): alt is NonNullable<typeof alt> => alt !== undefined,
              )
              .slice(0, 3)
              .map((alt, i) => {
                const href = `/${alt.slug}/${slugPath}`;
                return (
                  <React.Fragment key={alt.slug}>
                    {i > 0 && ", "}
                    <Link
                      href={href}
                      className="text-[var(--accent)] hover:underline"
                    >
                      {alt.name}
                    </Link>
                  </React.Fragment>
                );
              })}{" "}
            instead, or browse the{" "}
            <Link
              href={`/docs/${slugPath}`}
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

// Doc-page landing cards for the framework overview. Each entry declares
// the doc slug (relative to `/<framework>/`) plus the registry feature IDs
// that gate it. A card only renders when the integration declares at
// least one of its gating features — so `strands` (no HITL support) no
// longer shows a dead "Human-in-the-Loop" card the moment the framework
// registry says it's unsupported. When the registry ever drops a
// feature the card automatically disappears from the landing without a
// code edit.
//
// The registry doesn't currently expose a feature-id → doc-slug map
// (features and doc pages live in separate namespaces). Keep the
// gating feature list colocated with the card so any future mapping
// table can drop in as a replacement. Follow-up owners: move this into
// `feature-registry.json` once a canonical feature→docs-slug schema
// exists.
const FRAMEWORK_LANDING_CARDS: {
  docSlug: string;
  title: string;
  desc: string;
  gatingFeatures: string[];
}[] = [
  {
    docSlug: "agentic-chat-ui",
    title: "Chat UI",
    desc: "Pre-built chat components wired to the agent",
    gatingFeatures: ["agentic-chat", "prebuilt-sidebar", "prebuilt-popup"],
  },
  {
    docSlug: "generative-ui/tool-rendering",
    title: "Tool Rendering",
    desc: "Render agent tool calls as UI components",
    gatingFeatures: [
      "tool-rendering",
      "tool-rendering-default-catchall",
      "tool-rendering-custom-catchall",
    ],
  },
  {
    docSlug: "frontend-tools",
    title: "Frontend Tools",
    desc: "Expose client-side actions to the agent",
    gatingFeatures: ["frontend-tools"],
  },
  {
    docSlug: "human-in-the-loop",
    title: "Human-in-the-Loop",
    desc: "Intercept tool calls for approval",
    gatingFeatures: ["hitl-in-chat", "gen-ui-interrupt", "interrupt-headless"],
  },
];

function FrameworkLandingPage({ framework }: { framework: string }) {
  const integration = getIntegration(framework);
  if (!integration) notFound();

  const navTree = buildNavTree(CONTENT_DIR);
  const tree = navTree;

  const integrationFeatureSet = new Set(integration.features ?? []);
  const visibleCards = FRAMEWORK_LANDING_CARDS.filter((card) =>
    card.gatingFeatures.some((f) => integrationFeatureSet.has(f)),
  );

  return (
    <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
      <aside className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <Link
          href="/docs"
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

      <main className="flex-1 max-w-3xl px-8 py-8 overflow-y-auto">
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
          {visibleCards.map((card) => (
            <LandingCard
              key={card.docSlug}
              href={`/${framework}/${card.docSlug}`}
              title={card.title}
              desc={card.desc}
            />
          ))}
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
