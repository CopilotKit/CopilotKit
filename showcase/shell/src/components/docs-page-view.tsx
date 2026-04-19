// DocsPageView — shared server component that renders a single MDX doc
// with its sidebar, breadcrumbs, and page-level Snippet defaults.
//
// Used by both the classic `/docs/<slug>` route and the framework-scoped
// `/<framework>/<slug>` catch-all. The `slugHrefPrefix` prop controls
// how sidebar links and breadcrumbs are serialized back into URLs — so
// framework-scoped views keep every internal link in the `<framework>`
// namespace without duplicating the nav builder.

import React from "react";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { SidebarNav } from "@/components/sidebar-nav";
import { Snippet } from "@/components/snippet";
import { docsComponents } from "@/lib/mdx-registry";
import {
  NavNode,
  buildBreadcrumbs,
  buildNavTree,
  convertTablesInJSX,
  inlineSnippets,
  loadDoc,
  CONTENT_DIR,
} from "@/lib/docs-render";

export interface DocsPageViewProps {
  /** Slug path relative to `CONTENT_DIR` (no leading slash). */
  slugPath: string;
  /**
   * Prefix used to build sidebar + breadcrumb hrefs.
   * - `/docs` for the classic docs route
   * - `/<framework>` for framework-scoped pages
   */
  slugHrefPrefix: string;
  /** Optional framework slug to thread into <Snippet> as a default. */
  frameworkOverride?: string | null;
  /** Label for the sidebar's root link. */
  sidebarTitle?: string;
  /** Optional "back" link shown above the sidebar title. */
  backLink?: { label: string; href: string } | null;
  /** Pre-built nav tree. When omitted, defaults to the full docs tree. */
  navTree?: NavNode[];
  /** Banner slot rendered above the main content column. */
  bannerSlot?: React.ReactNode;
  /** When set, hide the main MDX body (used by pivot-only pages). */
  hideBody?: boolean;
}

export async function DocsPageView({
  slugPath,
  slugHrefPrefix,
  frameworkOverride,
  sidebarTitle = "CopilotKit Docs",
  backLink = null,
  navTree,
  bannerSlot,
  hideBody = false,
}: DocsPageViewProps) {
  const doc = loadDoc(slugPath);
  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold text-[var(--text)] mb-3">
          Not found
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          No page matches <code>{slugPath}</code>.
        </p>
      </div>
    );
  }

  const rawContent = doc.source.replace(/^---[\s\S]*?---\n?/, "");
  const inlined = inlineSnippets(rawContent, slugPath);
  const content = convertTablesInJSX(inlined);

  const defaultFramework = frameworkOverride ?? doc.fm.defaultFramework;
  const defaultCell = doc.fm.defaultCell;

  const tree = navTree ?? buildNavTree(CONTENT_DIR);
  const breadcrumbs = buildBreadcrumbs(slugPath, {
    rootLabel: sidebarTitle,
    rootHref: slugHrefPrefix || "/",
    slugHrefPrefix,
  });

  function renderNavItem(node: NavNode, depth: number = 0): React.ReactNode {
    const indent = depth * 16;
    if (node.type === "section") {
      return (
        <div
          key={`section-${node.title}`}
          className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mt-4 mb-2"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
      );
    }
    if (node.type === "page") {
      const isActive = node.slug === slugPath;
      return (
        <Link
          key={node.slug}
          href={`${slugHrefPrefix}/${node.slug}`}
          data-active={isActive ? "true" : undefined}
          className={`block py-[5px] text-[13px] transition-colors ${
            isActive
              ? "text-[var(--accent)] font-medium"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </Link>
      );
    }
    return (
      <div key={`group-${node.slug}`} className="mt-1">
        <div
          className="py-[5px] text-[13px] font-medium text-[var(--text-secondary)]"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
        {node.children.map((child) => renderNavItem(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
      <SidebarNav className="w-[220px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        {backLink && (
          <Link
            href={backLink.href}
            className="block text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-3 transition-colors"
          >
            {backLink.label}
          </Link>
        )}
        <Link
          href={slugHrefPrefix || "/"}
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4"
        >
          {sidebarTitle}
        </Link>
        {tree.map((node) => renderNavItem(node))}
      </SidebarNav>

      <main className="flex-1 max-w-3xl px-8 py-8 overflow-y-auto">
        <nav className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-4 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-[var(--text-faint)]">&gt;</span>}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="hover:text-[var(--text-secondary)] transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-[var(--text)]">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>

        <h1 className="text-[2rem] font-bold text-[var(--text)] tracking-tight mb-2 leading-tight">
          {doc.fm.title}
        </h1>
        {doc.fm.description && (
          <p className="text-base text-[var(--text-muted)] mb-6 leading-relaxed">
            {doc.fm.description}
          </p>
        )}

        {bannerSlot}

        {!hideBody && (
          <div className="reference-content">
            <MDXRemote
              source={content}
              components={{
                ...docsComponents,
                Snippet: (props: Record<string, unknown>) => (
                  <Snippet
                    {...(props as { region: string })}
                    defaultFramework={defaultFramework}
                    defaultCell={defaultCell}
                  />
                ),
              }}
              options={{
                mdxOptions: {
                  remarkPlugins: [remarkGfm],
                  rehypePlugins: [rehypeHighlight],
                },
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
