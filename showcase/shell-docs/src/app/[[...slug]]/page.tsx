// /<...slug> — the framework-agnostic docs entry point.
//
// When a framework is already selected (URL-scoped or from localStorage
// via <RouterPivot>'s useEffect), the user is auto-redirected to
// `/<framework>/<slug>`. Otherwise we render a "pick an agentic
// backend" pivot UI above the page title and hide the MDX body until
// the user chooses one — code without a backend context is incomplete.

import React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarNav } from "@/components/sidebar-nav";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { CONTENT_DIR, buildNavTree } from "@/lib/docs-render";
import type { NavNode } from "@/lib/docs-render";
import { getBaseUrl } from "@/lib/sitemap-helpers";

// Per-framework self-canonical: each variant of a doc page declares
// itself canonical so search engines index every framework's quickstart
// (etc.) at its own URL rather than collapsing them all onto the bare
// /quickstart. Done at the page level so the metadata depends on params.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const slugPath = slug && slug.length > 0 ? `/${slug.join("/")}` : "";
  return {
    alternates: {
      canonical: `${getBaseUrl()}${slugPath}`,
    },
  };
}

function DocsOverview() {
  const navTree = buildNavTree(CONTENT_DIR);

  return (
    <div className="flex" style={{ height: "calc(100vh - 53px)" }}>
      <SidebarNav className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
        <div className="mb-4" />
        {navTree.map((node) => (
          <OverviewNavItem key={nodeKey(node)} node={node} />
        ))}
      </SidebarNav>

      {/* <main> is the full-width scroll container so the scrollbar
       * lands at the viewport edge. Content width is capped by the
       * inner wrapper below. */}
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

          {/* CLI command — universal entry point for fresh projects. */}
          <div className="mb-10 max-w-2xl">
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Starting from scratch? Bootstrap a full-stack agent in one
              command:
            </p>
            <pre className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-sm font-mono overflow-x-auto">
              <code>npx copilotkit@latest create</code>
            </pre>
          </div>

          {/* Utility cards: orientation + reference + gen-UI. The
            framework-aware Quickstart entry lives in <DocsLandingNext />
            below, where it can branch on storedFramework. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
            <Link
              href="/concepts/architecture"
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
              href="/generative-ui/your-components/display-only"
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

          {/* Conditional next-step block: framework picker if no
            storedFramework, "what's next" pointers into that
            framework's docs if there is one. Replaces the former
            two-step "Pick a backend / Or jump into a topic" panels. */}
          <DocsLandingNext />
        </div>
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
      {node.title && (
        <div
          className="py-[5px] text-[13px] font-medium text-[var(--text-secondary)]"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
      )}
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
