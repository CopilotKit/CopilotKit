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
import {
  ArrowRight,
  Blocks,
  Bot,
  Braces,
  Code2,
  MessageSquare,
  Workflow,
} from "lucide-react";
import { DocsLandingNext } from "@/components/docs-landing-next";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { buildFrameworkOnlyNav, loadDoc } from "@/lib/docs-render";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { getDocsFolder, getIntegration } from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";

// Force dynamic rendering so unknown slugs reliably return HTTP 404
// from `notFound()` instead of being cached as a 200 with the not-found
// UI baked in (the search-engine-killing soft-404). The bare home page
// and known unscoped docs are still cheap to render — they're
// filesystem reads of MDX content — and Railway / upstream CDN caches
// successful responses at the edge anyway.
export const dynamic = "force-dynamic";

// Soft-default framework rendered on the bare `/` URL. BIA is the
// "Built-in Agent" path and uses `docs_mode: authored`, so its sidebar
// is its own authored tree under `integrations/built-in-agent/`.
// Hardcoding it here keeps the sidebar tree on `/` identical to what
// the user sees after clicking any BIA sidebar link (e.g. /built-in-agent/quickstart),
// instead of showing the unrelated generated all-content tree on `/`
// and then morphing on first navigation.
const HOME_DEFAULT_FRAMEWORK = "built-in-agent";

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
      title: "CopilotKit: the frontend stack for agents",
      description:
        "Connect any agent framework or model to your React app for chat, generative UI, canvas, and human-in-the-loop workflows.",
      canonicalPath: "/",
    });
  }
  const doc = loadDoc(slugPath);
  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath,
    ogPath: `/og${canonicalPath}/og.png`,
  });
}

function DocsOverview() {
  // Sidebar matches the soft-default framework (BIA, `docs_mode: authored`)
  // so the home `/` and the post-click `/built-in-agent/...` views share
  // an identical sidebar tree. Mirrors the `authored`-mode branch in
  // `/<framework>/<...slug>` (page.tsx): `buildFrameworkOnlyNav(docsFolder)`
  // for the tree, `/<framework>` for the link prefix.
  const docsFolder = getDocsFolder(HOME_DEFAULT_FRAMEWORK);
  const navTree = buildFrameworkOnlyNav(docsFolder);
  const pageTree = navTreeToPageTree(navTree, `/${HOME_DEFAULT_FRAMEWORK}`);

  // Rewrite the Introduction entry's URL from `/built-in-agent` (or
  // `/built-in-agent/index`) to `/` so it matches the home-page URL and
  // gets the active highlight on landing. Walk the tree recursively
  // because Fumadocs's PageTree can nest pages inside folders.
  const homeUrlCandidates = new Set([
    `/${HOME_DEFAULT_FRAMEWORK}`,
    `/${HOME_DEFAULT_FRAMEWORK}/`,
    `/${HOME_DEFAULT_FRAMEWORK}/index`,
  ]);
  type PT = (typeof pageTree.children)[number];
  const rewriteUrls = (nodes: readonly PT[]): PT[] =>
    nodes.map((node): PT => {
      if (node.type === "page" && homeUrlCandidates.has(node.url)) {
        return { ...node, url: "/" };
      }
      if (node.type === "folder") {
        const next: typeof node = {
          ...node,
          children: rewriteUrls(node.children) as typeof node.children,
        };
        if (node.index && homeUrlCandidates.has(node.index.url)) {
          next.index = { ...node.index, url: "/" };
        }
        return next;
      }
      return node;
    });
  const homePageTree = {
    ...pageTree,
    children: rewriteUrls(pageTree.children),
  };
  const homeIntegration = getIntegration(HOME_DEFAULT_FRAMEWORK);
  const stackItems = [
    {
      label: "Frontend",
      title: "React UX primitives",
      detail: "Chat, generative UI, shared state, and HITL controls.",
      icon: <MessageSquare className="h-4 w-4" />,
    },
    {
      label: "Runtime",
      title: "AG-UI transport",
      detail: "Event streams, tools, state snapshots, and observability.",
      icon: <Workflow className="h-4 w-4" />,
    },
    {
      label: "Agent",
      title: "Any backend",
      detail: "LangGraph, ADK, Mastra, CrewAI, PydanticAI, and more.",
      icon: <Bot className="h-4 w-4" />,
    },
  ];
  const primaryCards = [
    {
      href: "/built-in-agent/quickstart",
      title: "Start building",
      body: "Create a working CopilotKit app with the built-in agent.",
      icon: <Code2 className="h-4 w-4" />,
    },
    {
      href: "/built-in-agent/generative-ui/tool-rendering",
      title: "Render agent UI",
      body: "Turn tool calls and state into first-class React components.",
      icon: <Blocks className="h-4 w-4" />,
    },
    {
      href: "/reference",
      title: "API Reference",
      body: "Hooks, components, runtime config, and integration APIs.",
      icon: <Braces className="h-4 w-4" />,
    },
  ];

  return (
    <ShellDocsLayout tree={homePageTree} banner={<SidebarFrameworkSelector />}>
      <div className="docs-inner-content max-w-[1040px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
        <section className="pt-7 sm:pt-10 pb-8 sm:pb-10">
          <div className="mb-7 flex flex-col gap-5">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1.5 text-[11px] font-semibold uppercase text-[var(--text-muted)]">
              <FrameworkLogo
                slug={HOME_DEFAULT_FRAMEWORK}
                fallbackSrc={homeIntegration?.logo}
                size={14}
                className="text-[var(--accent)]"
              />
              Frontend stack for agents
            </div>
            <div>
              <h1 className="max-w-4xl text-[2.45rem] sm:text-[3.25rem] font-semibold text-[var(--text)] tracking-tight leading-[1.02]">
                CopilotKit connects agent backends to real product interfaces.
              </h1>
              <p className="mt-5 max-w-3xl text-base sm:text-lg text-[var(--text-secondary)] leading-relaxed">
                Build chat, generative UI, shared state, canvas apps, and
                human-in-the-loop workflows on top of LangGraph, Google ADK,
                Mastra, PydanticAI, CrewAI, the built-in agent, or any AG-UI
                compatible backend.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/built-in-agent/quickstart"
                className="inline-flex h-10 w-fit items-center gap-2 rounded-full bg-[var(--text)] px-4 text-sm font-semibold text-[var(--bg-surface)] no-underline transition-opacity hover:opacity-90"
              >
                Start with the built-in agent
                <ArrowRight className="h-4 w-4" />
              </Link>
              <div className="flex min-w-0 items-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
                <code className="font-mono text-sm text-[var(--text)] overflow-x-auto whitespace-nowrap">
                  npx copilotkit@latest create
                </code>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              {stackItems.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/45 p-4"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase text-[var(--text-muted)]">
                      {item.label}
                    </span>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--accent)]">
                      {item.icon}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {item.title}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {item.detail}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]/45 p-3 text-[12px] text-[var(--text-muted)]">
              {[
                "LangGraph",
                "Google ADK",
                "Mastra",
                "PydanticAI",
                "CrewAI",
                "AG-UI",
              ].map((label) => (
                <span
                  key={label}
                  className="rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1 font-medium text-[var(--text-secondary)]"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {primaryCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex min-h-[148px] flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 no-underline hover:border-[var(--accent)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)]">
                  {card.icon}
                </span>
                <ArrowRight className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />
              </div>
              <div>
                <div className="font-semibold text-[var(--text)]">
                  {card.title}
                </div>
                <div className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
                  {card.body}
                </div>
              </div>
            </Link>
          ))}
        </div>

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
