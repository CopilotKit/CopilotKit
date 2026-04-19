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
import {
  CONTENT_DIR,
  buildNavTree,
  loadDoc,
  readMeta,
} from "@/lib/docs-render";
import { getIntegrations, getFeature } from "@/lib/registry";
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

function DocsOverview() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
        CopilotKit Documentation
      </h1>
      <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10">
        Guides, tutorials, and integration documentation for building AI-powered
        applications with CopilotKit.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-10">
        <Link
          href="/docs/agentic-chat-ui"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Agentic Chat UI
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Build chat interfaces with CopilotKit components
          </p>
        </Link>
        <Link
          href="/docs/frontend-tools"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Frontend Tools
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Define tools your agent can call on the frontend
          </p>
        </Link>
        <Link
          href="/docs/generative-ui"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Generative UI
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Let your agent generate interactive UI components
          </p>
        </Link>
        <Link
          href="/docs/backend/copilot-runtime"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Copilot Runtime
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Server-side runtime for connecting agents
          </p>
        </Link>
        <Link
          href="/docs/integrations"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Integrations
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            LangGraph, Mastra, CrewAI, and more
          </p>
        </Link>
        <Link
          href="/docs/learn"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Learn
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Tutorials and learning resources
          </p>
        </Link>
      </div>
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

  return (
    <DocsPageView
      slugPath={slugPath}
      slugHrefPrefix="/docs"
      sidebarTitle={sidebarTitle}
      backLink={backLink}
      navTree={navTree}
      bannerSlot={pivot}
      ContentWrapper={showPivot ? FrameworkGuardedContent : undefined}
    />
  );
}
