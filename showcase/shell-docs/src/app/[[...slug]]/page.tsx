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
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { CONTENT_DIR, buildNavTree } from "@/lib/docs-render";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
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
  const pageTree = navTreeToPageTree(navTree, "");

  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
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
            Starting from scratch? Bootstrap a full-stack agent in one command:
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
