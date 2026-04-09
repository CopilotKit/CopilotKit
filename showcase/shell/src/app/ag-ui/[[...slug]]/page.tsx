import React from "react";
import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Link from "next/link";
import {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { SidebarNav } from "@/components/sidebar-nav";
import { PropertyReference } from "@/components/property-reference";
import { getRegistry } from "@/lib/registry";

const CONTENT_DIR = path.join(process.cwd(), "src/content/ag-ui");

// A nav entry is either a page (slug) or a named sub-group with children
type NavEntry = string | { group: string; children: NavEntry[] };
type NavSection = { section: string; entries: NavEntry[] };
type NavTab = { tab: string; sections: NavSection[] };

// Hardcoded navigation matching the original AG-UI docs.json structure.
// Only these pages appear in the sidebar — no filesystem scanning.
const NAV_DEFINITION: NavTab[] = [
  {
    tab: "Docs",
    sections: [
      {
        section: "Get Started",
        entries: [
          "introduction",
          "agentic-protocols",
          {
            group: "Quickstart",
            children: [
              "quickstart/applications",
              {
                group: "Build integrations",
                children: [
                  "quickstart/introduction",
                  "quickstart/server",
                  "quickstart/middleware",
                ],
              },
              "quickstart/clients",
            ],
          },
        ],
      },
      {
        section: "Concepts",
        entries: [
          "concepts/architecture",
          "concepts/events",
          "concepts/agents",
          "concepts/middleware",
          "concepts/messages",
          "concepts/reasoning",
          "concepts/state",
          "concepts/serialization",
          "concepts/tools",
          "concepts/capabilities",
          "concepts/generative-ui-specs",
        ],
      },
      {
        section: "Draft Proposals",
        entries: [
          "drafts/overview",
          "drafts/multimodal-messages",
          "drafts/interrupts",
          "drafts/generative-ui",
          "drafts/meta-events",
        ],
      },
      {
        section: "Tutorials",
        entries: ["tutorials/cursor", "tutorials/debugging"],
      },
      {
        section: "Development",
        entries: [
          "development/updates",
          "development/roadmap",
          "development/contributing",
        ],
      },
    ],
  },
  {
    tab: "SDKs",
    sections: [
      {
        section: "TypeScript",
        entries: [
          {
            group: "@ag-ui/core",
            children: [
              "sdk/js/core/overview",
              "sdk/js/core/types",
              "sdk/js/core/multimodal-inputs",
              "sdk/js/core/events",
            ],
          },
          {
            group: "@ag-ui/client",
            children: [
              "sdk/js/client/overview",
              "sdk/js/client/abstract-agent",
              "sdk/js/client/http-agent",
              "sdk/js/client/middleware",
              "sdk/js/client/subscriber",
              "sdk/js/client/compaction",
            ],
          },
          // sdk/js/encoder and sdk/js/proto removed (empty placeholder pages)
        ],
      },
      {
        section: "Python",
        entries: [
          {
            group: "ag_ui.core",
            children: [
              "sdk/python/core/overview",
              "sdk/python/core/types",
              "sdk/python/core/multimodal-inputs",
              "sdk/python/core/events",
            ],
          },
          {
            group: "ag_ui.encoder",
            children: ["sdk/python/encoder/overview"],
          },
        ],
      },
    ],
  },
];

// Read the title for a given slug from its MDX file
function getTitleForSlug(slug: string): string {
  const filePath = path.join(CONTENT_DIR, `${slug}.mdx`);
  if (!fs.existsSync(filePath)) {
    return slug.split("/").pop()?.replace(/-/g, " ") || slug;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1].replace(/["']$/, "");
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];
  return slug.split("/").pop()?.replace(/-/g, " ") || slug;
}

// Resolved nav types used for rendering
type ResolvedPage = { kind: "page"; slug: string; title: string };
type ResolvedGroup = {
  kind: "group";
  name: string;
  children: ResolvedNavItem[];
};
type ResolvedNavItem = ResolvedPage | ResolvedGroup;
type ResolvedSection = { section: string; items: ResolvedNavItem[] };
type ResolvedTab = { tab: string; sections: ResolvedSection[] };

function resolveEntry(entry: NavEntry): ResolvedNavItem {
  if (typeof entry === "string") {
    return { kind: "page", slug: entry, title: getTitleForSlug(entry) };
  }
  return {
    kind: "group",
    name: entry.group,
    children: entry.children.map(resolveEntry),
  };
}

function getNavTabs(): ResolvedTab[] {
  return NAV_DEFINITION.map((tab) => ({
    tab: tab.tab,
    sections: tab.sections.map((sec) => ({
      section: sec.section,
      items: sec.entries.map(resolveEntry),
    })),
  }));
}

const components = {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  PropertyReference,
  InlineDemo: ({
    integration,
    demo,
  }: {
    integration?: string;
    demo?: string;
  }) => {
    if (!integration || !demo) return null;
    const reg = getRegistry();
    const int = reg.integrations.find((i) => i.slug === integration);
    if (!int || !int.deployed) return null;
    const demoUrl = `${int.backend_url}/demos/${demo}`;
    return (
      <div className="my-6 rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Live Demo: {int.name} — {demo}
          </span>
          <a
            href={`/integrations/${integration}?demo=${demo}`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Open full demo →
          </a>
        </div>
        <iframe
          src={demoUrl}
          className="w-full"
          style={{ height: "500px" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    );
  },
  Note: Callout,
  Warning: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  Tip: ({ children }: { children: React.ReactNode }) => (
    <Callout type="info">{children}</Callout>
  ),
  // Mintlify components we shim
  CardGroup: Cards,
  Steps: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Step: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div style={{ marginBottom: "1rem" }}>
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
};

function OverviewContent() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold text-[var(--violet)] tracking-tight mb-3">
        The Agent-User Interaction Protocol
      </h1>
      <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10">
        AG-UI is an open protocol for connecting AI agents to frontend
        applications. It defines a standard event-based interface for streaming
        agent state, tool calls, and generative UI to any client.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-left mb-10">
        <Link
          href="/ag-ui/concepts/architecture"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            Concepts
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Architecture, events, agents, state, tools, middleware
          </p>
        </Link>
        <Link
          href="/ag-ui/quickstart/introduction"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            Quick Start
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Build your first AG-UI integration step by step
          </p>
        </Link>
        <Link
          href="/ag-ui/sdk/js/core/overview"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            JavaScript SDK
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            @ag-ui/core, @ag-ui/client, @ag-ui/encoder
          </p>
        </Link>
        <Link
          href="/ag-ui/sdk/python/core/overview"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            Python SDK
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            ag_ui.core, ag_ui.encoder
          </p>
        </Link>
        <Link
          href="/ag-ui/tutorials/cursor"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            Tutorials
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Hands-on guides and debugging walkthroughs
          </p>
        </Link>
        <a
          href="https://github.com/ag-ui-protocol/ag-ui"
          target="_blank"
          rel="noopener noreferrer"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--violet)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--violet)] mb-1">
            GitHub
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Open source · Apache 2.0 · ag-ui-protocol/ag-ui
          </p>
        </a>
      </div>

      <p className="text-xs text-[var(--text-faint)]">
        2 SDKs · 15+ framework adapters · Open protocol
      </p>
    </div>
  );
}

export default async function AgUiDocPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const isOverview = !slug || slug.length === 0;
  const slugPath = isOverview ? "" : slug.join("/");

  const navTabs = getNavTabs();

  function renderNavItem(
    item: ResolvedNavItem,
    depth: number = 0,
  ): React.ReactNode {
    const indent = depth * 16;
    if (item.kind === "page") {
      const isActive = item.slug === slugPath;
      return (
        <Link
          key={item.slug}
          href={`/ag-ui/${item.slug}`}
          data-active={isActive ? "true" : undefined}
          className={`block py-[5px] text-[14px] transition-colors ${
            isActive
              ? "text-[var(--text)] font-medium"
              : "text-[var(--text-secondary)] hover:text-[var(--text)]"
          }`}
          style={{ paddingLeft: `${indent}px` }}
        >
          {item.title}
        </Link>
      );
    }
    return (
      <div key={item.name} className="mt-2">
        <div
          className="py-[5px] text-[14px] text-[var(--text-muted)]"
          style={{ paddingLeft: `${indent}px` }}
        >
          {item.name}
        </div>
        {item.children.map((child) => renderNavItem(child, depth + 1))}
      </div>
    );
  }

  // Overview page: no sidebar, card-based landing
  if (isOverview) {
    return <OverviewContent />;
  }

  // Doc page: sidebar + MDX content
  let filePath = path.join(CONTENT_DIR, `${slugPath}.mdx`);

  if (!fs.existsSync(filePath)) {
    const indexPath = path.join(CONTENT_DIR, slugPath, "index.mdx");
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      notFound();
    }
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const content = source.replace(/^---[\s\S]*?---\n?/, "");
  const titleMatch =
    source.match(/title:\s*["']?(.+?)["']?\s*$/m) ||
    content.match(/^#\s+(.+)$/m);
  const title =
    titleMatch?.[1] || slugPath.split("/").pop()?.replace(/-/g, " ") || "AG-UI";

  return (
    <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
      {/* Sidebar */}
      <SidebarNav className="w-[220px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <Link
          href="/ag-ui"
          className="block text-xs font-mono uppercase tracking-widest text-[var(--violet)] mb-4"
        >
          AG-UI Protocol
        </Link>
        {navTabs.map((tab, i) => (
          <div
            key={tab.tab}
            className={i > 0 ? "mt-6 pt-5 border-t border-[var(--border)]" : ""}
          >
            {tab.sections.map(({ section, items }) => (
              <div key={section} className="mb-5">
                <div className="text-[13px] font-semibold text-[var(--text)] mb-2">
                  {section}
                </div>
                {items.map((item) => renderNavItem(item))}
              </div>
            ))}
          </div>
        ))}
      </SidebarNav>

      {/* Content */}
      <main className="flex-1 max-w-3xl px-8 py-8 overflow-y-auto">
        <h1 className="text-2xl font-semibold text-[var(--text)] tracking-tight mb-6">
          {title}
        </h1>
        <div className="reference-content">
          <MDXRemote
            source={content}
            components={components}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [rehypeHighlight],
              },
            }}
          />
        </div>
      </main>
    </div>
  );
}
