// /<...slug> — the framework-agnostic docs entry point.
//
// When a framework is already selected (URL-scoped or from localStorage
// via <RouterPivot>'s useEffect), the user is auto-redirected to
// `/<framework>/<slug>`. Otherwise we render a "pick an agentic
// backend" pivot UI above the page title and hide the MDX body until
// the user chooses one — code without a backend context is incomplete.

import React from "react";
import Link from "next/link";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarNav } from "@/components/sidebar-nav";
import { StoredFrameworkHighlight } from "@/components/stored-framework-highlight";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import {
  CONTENT_DIR,
  FRAMEWORK_CATEGORY_ORDER,
  buildNavTree,
  type NavNode,
} from "@/lib/docs-render";
import {
  getIntegrations,
  getCategoryLabel,
  type Integration,
} from "@/lib/registry";

// Category ordering for the framework picker grid is imported from
// @/lib/docs-render so the landing grid, sidebar dropdown, and this
// overview share a single source of truth.

// Docs-section cards shown beneath the framework picker. Each href
// targets the framework-agnostic root route — when the user already
// has a framework stored, `<RouterPivot>` on the destination page
// redirects them into the scoped view.
const DOCS_SECTIONS: {
  href: string;
  title: string;
  description: string;
  category: string;
}[] = [
  {
    href: "/quickstart",
    title: "Quickstart",
    description: "Five-minute setup for a working copilot",
    category: "Getting Started",
  },
  {
    href: "/coding-agents",
    title: "Coding Agents",
    description: "Bootstrap with Claude Code, Cursor, Windsurf, and friends",
    category: "Getting Started",
  },
  {
    href: "/agentic-chat-ui",
    title: "Chat Components",
    description: "Drop-in CopilotChat & CopilotSidebar for agentic chat",
    category: "Basics",
  },
  {
    href: "/custom-look-and-feel",
    title: "Custom Look & Feel",
    description: "Theme, slot, and fully-headless chat UI",
    category: "Basics",
  },
  {
    href: "/generative-ui",
    title: "Generative UI",
    description: "Render live React components from the agent's stream",
    category: "Generative UI",
  },
  {
    href: "/frontend-tools",
    title: "Frontend Tools",
    description: "Expose client-side actions to the agent",
    category: "App Control",
  },
  {
    href: "/shared-state",
    title: "Shared State",
    description: "Two-way state binding between the UI and the agent",
    category: "App Control",
  },
  {
    href: "/human-in-the-loop",
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
          href="/"
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
                  {items.map((i) => {
                    // Undeployed integrations render as non-interactive
                    // cards. The framework catch-all route would happily
                    // serve a landing page for any registry entry, but
                    // that page has no live demos wired up — clicking an
                    // undeployed card would drop the user on a dead end.
                    // The "soon" pill + dimmed styling already signal
                    // not-ready; stripping the <Link> makes the
                    // affordance match the signal.
                    const cardContent = (
                      <>
                        {i.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={i.logo}
                            alt=""
                            className="w-5 h-5 shrink-0"
                          />
                        ) : (
                          <span className="w-5 h-5 shrink-0" />
                        )}
                        <span
                          className={`flex-1 min-w-0 truncate text-sm font-medium text-[var(--text)] ${
                            i.deployed ? "group-hover:text-[var(--accent)]" : ""
                          }`}
                        >
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
                      </>
                    );
                    if (i.deployed) {
                      return (
                        <Link
                          key={i.slug}
                          href={`/${i.slug}`}
                          className="group relative flex items-center gap-2 p-3 rounded-lg border transition-all border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] hover:shadow-sm"
                        >
                          {cardContent}
                        </Link>
                      );
                    }
                    return (
                      <div
                        key={i.slug}
                        aria-disabled="true"
                        className="group relative flex items-center gap-2 p-3 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-elevated)] opacity-70 cursor-not-allowed"
                      >
                        {cardContent}
                      </div>
                    );
                  })}
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
                  <SidebarLink
                    key={s.href}
                    slug={s.href.slice(1)}
                    className="group p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
                  >
                    <div className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
                      {s.title}
                    </div>
                    <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                      {s.description}
                    </div>
                  </SidebarLink>
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
      <div style={{ paddingLeft: `${indent}px` }}>
        <SidebarLink
          slug={node.slug}
          className="block py-[5px] text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          {node.title}
        </SidebarLink>
      </div>
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

  // Overview page when no slug — the only path this route exclusively owns.
  // All other paths (e.g. /quickstart) are intercepted by [framework] first
  // due to Next.js routing precedence and fall through to UnscopedDocsPage there.
  if (!slug || slug.length === 0) {
    return <DocsOverview />;
  }

  return <UnscopedDocsPage slugPath={slug.join("/")} />;
}
