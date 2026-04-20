// /docs/<...slug> — the framework-agnostic docs entry point.
//
// When a framework is already selected (URL-scoped or from localStorage
// via <RouterPivot>'s useEffect), the user is auto-redirected to
// `/<framework>/<slug>`. Otherwise we render a "pick an agentic
// backend" pivot UI above the page title and hide the MDX body until
// the user chooses one — code without a backend context is incomplete.

import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DocsPageView } from "@/components/docs-page-view";
import {
  FrameworkGuardedContent,
  RouterPivot,
} from "@/components/router-pivot";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { SidebarNav } from "@/components/sidebar-nav";
import { StoredFrameworkHighlight } from "@/components/stored-framework-highlight";
import {
  CONTENT_DIR,
  buildNavTree,
  loadDoc,
  readMeta,
  type NavNode,
} from "@/lib/docs-render";
import {
  getIntegrations,
  getFeature,
  getCategoryLabel,
  type Integration,
} from "@/lib/registry";
import demoContent from "@/data/demo-content.json";

interface DemoRecord {
  regions?: Record<string, unknown>;
}
const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

function findFrameworksWithCell(cell: string): string[] {
  const matches: string[] = [];
  for (const integration of getIntegrations()) {
    if (demos[`${integration.slug}::${cell}`]) matches.push(integration.slug);
  }
  return matches;
}

// Category ordering for the framework picker grid — mirrors the
// integrations page and the sidebar dropdown so the UX reads the same
// everywhere.
const FRAMEWORK_CATEGORY_ORDER = [
  "popular",
  "agent-framework",
  "provider-sdk",
  "enterprise-platform",
  "protocol",
  "emerging",
  "starter",
] as const;

// Docs-section cards shown beneath the framework picker. Each href
// targets the framework-agnostic route under `/docs/<slug>` — when the
// user already has a framework stored, `<RouterPivot>` on the
// destination page redirects them into the scoped view.
const DOCS_SECTIONS: {
  href: string;
  title: string;
  description: string;
  category: string;
}[] = [
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    description: "Five-minute setup for a working copilot",
    category: "Getting Started",
  },
  {
    href: "/docs/coding-agents",
    title: "Coding Agents",
    description: "Bootstrap with Claude Code, Cursor, Windsurf, and friends",
    category: "Getting Started",
  },
  {
    href: "/docs/agentic-chat-ui",
    title: "Chat Components",
    description: "Drop-in CopilotChat & CopilotSidebar for agentic chat",
    category: "Basics",
  },
  {
    href: "/docs/custom-look-and-feel",
    title: "Custom Look & Feel",
    description: "Theme, slot, and fully-headless chat UI",
    category: "Basics",
  },
  {
    href: "/docs/generative-ui",
    title: "Generative UI",
    description: "Render live React components from the agent's stream",
    category: "Generative UI",
  },
  {
    href: "/docs/frontend-tools",
    title: "Frontend Tools",
    description: "Expose client-side actions to the agent",
    category: "App Control",
  },
  {
    href: "/docs/shared-state",
    title: "Shared State",
    description: "Two-way state binding between the UI and the agent",
    category: "App Control",
  },
  {
    href: "/docs/human-in-the-loop",
    title: "Human-in-the-Loop",
    description: "Intercept tool calls for explicit user approval",
    category: "App Control",
  },
];

function DocsOverview() {
  const integrations = getIntegrations()
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

  // Bucket integrations by category, honoring the canonical ordering.
  const buckets = new Map<string, Integration[]>();
  for (const cat of FRAMEWORK_CATEGORY_ORDER) buckets.set(cat, []);
  buckets.set("other", []);
  for (const i of integrations) {
    const key = buckets.has(i.category) ? i.category : "other";
    buckets.get(key)!.push(i);
  }

  const navTree = buildNavTree(CONTENT_DIR);

  // Preserve insertion order while grouping section cards by category.
  const sectionsByCategory = new Map<string, typeof DOCS_SECTIONS>();
  for (const s of DOCS_SECTIONS) {
    if (!sectionsByCategory.has(s.category))
      sectionsByCategory.set(s.category, []);
    sectionsByCategory.get(s.category)!.push(s);
  }

  return (
    <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
      <SidebarNav className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <Link
          href="/docs"
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4"
        >
          CopilotKit Docs
        </Link>
        {navTree.map((node) => (
          <OverviewNavItem key={nodeKey(node)} node={node} />
        ))}
      </SidebarNav>

      <main className="flex-1 max-w-4xl px-8 py-10 overflow-y-auto">
        <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
          Documentation
        </div>
        <h1 className="text-[2.25rem] font-bold text-[var(--text)] tracking-tight mb-3 leading-tight">
          Build AI-powered apps with CopilotKit
        </h1>
        <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10 max-w-2xl">
          CopilotKit ships deep integrations across every major agent framework
          and SDK. Pick your <em>agentic backend</em> below — the rest of the
          docs adapt every snippet and code sample to that framework.
        </p>

        {/* Framework picker — big grid of all integrations, grouped by category */}
        <section className="mb-12">
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
            Step 1
          </div>
          <h2 className="text-xl font-semibold text-[var(--text)] mb-1">
            Pick an agentic backend
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-5">
            We store your choice locally so every page renders the right code.
          </p>

          {[...buckets.entries()].map(([catId, items]) => {
            if (items.length === 0) return null;
            const label = catId === "other" ? "Other" : getCategoryLabel(catId);
            return (
              <div key={catId} className="mb-6">
                <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-3">
                  {label}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {items.map((i) => (
                    <Link
                      key={i.slug}
                      href={`/${i.slug}`}
                      className={`group relative flex items-center gap-2 p-3 rounded-lg border transition-all ${
                        i.deployed
                          ? "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:shadow-sm"
                          : "border-[var(--border-dim)] bg-[var(--bg-elevated)] opacity-70"
                      }`}
                    >
                      {i.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.logo} alt="" className="w-5 h-5 shrink-0" />
                      ) : (
                        <span className="w-5 h-5 shrink-0" />
                      )}
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-[var(--text)] group-hover:text-[var(--accent)]">
                        {i.name}
                      </span>
                      {!i.deployed && (
                        <span className="text-[9px] font-mono uppercase tracking-widest text-[var(--text-faint)]">
                          soon
                        </span>
                      )}
                      {/* Marks the framework currently stored in
                          localStorage so repeat visitors can spot "their"
                          choice at a glance without an auto-redirect. */}
                      <StoredFrameworkHighlight slug={i.slug} />
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* Section cards — grouped by broad topic. Clicking any of
            these before picking a framework lands on the per-feature
            pivot; once a framework is stored the destination's
            <RouterPivot /> redirects into the scoped view. */}
        <section>
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
            Step 2
          </div>
          <h2 className="text-xl font-semibold text-[var(--text)] mb-5">
            Or jump into a topic
          </h2>

          {[...sectionsByCategory.entries()].map(([catLabel, sections]) => (
            <div key={catLabel} className="mb-6">
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mb-3">
                {catLabel}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sections.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    className="group p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
                  >
                    <div className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
                      {s.title}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                      {s.description}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

// Render a single nav node for the overview sidebar. Unlike
// `<DocsPageView>`, there is no active slug here — this is the docs
// root — so every page link is rendered in its idle state.
function nodeKey(node: NavNode): string {
  if (node.type === "section") return `section-${node.title}`;
  if (node.type === "page") return `page-${node.slug}`;
  return `group-${node.slug}`;
}

function OverviewNavItem({
  node,
  depth = 0,
}: {
  node: NavNode;
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
        href={`/docs/${node.slug}`}
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
      {node.children.map((child) => (
        <OverviewNavItem key={nodeKey(child)} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  // Overview page when no slug
  if (!slug || slug.length === 0) {
    return <DocsOverview />;
  }

  const slugPath = slug.join("/");
  const doc = loadDoc(slugPath);
  if (!doc) notFound();

  // Integration-scoped sidebar: if under integrations/<framework>, scope to that
  let navTree;
  let sidebarTitle = "CopilotKit Docs";
  let backLink = null;
  let showPivot = true;
  const integrationMatch = slugPath.match(/^integrations\/([^/]+)/);
  if (integrationMatch) {
    const framework = integrationMatch[1];
    const frameworkDir = `${CONTENT_DIR}/integrations/${framework}`;
    const frameworkMeta = readMeta(frameworkDir);
    sidebarTitle =
      frameworkMeta?.title ||
      framework.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    navTree = buildNavTree(frameworkDir, `integrations/${framework}`);
    backLink = { label: "\u2190 Back to Docs", href: "/docs" };
    // Integration-scoped pages are framework-specific content and
    // shouldn't be pivoted on.
    showPivot = false;
  } else {
    navTree = buildNavTree(CONTENT_DIR);
  }

  // Build options + "which frameworks have this cell" for the pivot UI.
  const options = getIntegrations()
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category ?? "other",
      logo: i.logo ?? null,
      deployed: i.deployed,
    }));

  const frameworksWithCell = doc.fm.defaultCell
    ? findFrameworksWithCell(doc.fm.defaultCell)
    : [];

  // Look up the feature record for an animated preview URL, if any
  const featureFromCell = doc.fm.defaultCell
    ? getFeature(doc.fm.defaultCell)
    : undefined;
  // Fallback to the first integration that implements the feature and
  // has an animated preview.
  let previewUrl: string | null | undefined = undefined;
  if (doc.fm.defaultCell) {
    for (const integration of getIntegrations()) {
      const demo = integration.demos?.find((d) => d.id === doc.fm.defaultCell);
      if (demo?.animated_preview_url) {
        previewUrl = demo.animated_preview_url;
        break;
      }
    }
  }

  const pivot =
    showPivot && doc.fm.defaultCell ? (
      <div className="mb-8">
        <RouterPivot
          slugPath={slugPath}
          options={options}
          frameworksWithCell={frameworksWithCell}
          previewUrl={previewUrl}
          featureName={featureFromCell?.name ?? doc.fm.title}
          featureDescription={
            featureFromCell?.description ?? doc.fm.description
          }
        />
      </div>
    ) : null;

  // Only gate the body behind a framework pick when the page actually
  // depends on one (i.e. has a `defaultCell` whose code needs a backend
  // to make sense). Framework-agnostic pages like `/docs/learn/*` —
  // protocol overviews, concept explainers, architecture diagrams —
  // render their prose unconditionally.
  const contentIsFrameworkScoped = showPivot && !!doc.fm.defaultCell;

  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix="/docs"
      sidebarTitle={sidebarTitle}
      backLink={backLink}
      navTree={navTree}
      bannerSlot={pivot}
      ContentWrapper={
        contentIsFrameworkScoped ? FrameworkGuardedContent : undefined
      }
    />
  );
}
