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
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
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
  /**
   * Optional client component that wraps the MDX body — used by the
   * `/docs/<feature>` router pages to conditionally hide code when no
   * framework is selected. Must accept `children` and render them
   * (or suppress them) based on its own state.
   */
  ContentWrapper?: React.ComponentType<{ children: React.ReactNode }>;
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
  ContentWrapper,
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

  // Strip the YAML frontmatter block. `\r?\n?` at the tail handles both
  // LF- and CRLF-authored MDX; otherwise Windows line endings leave the
  // trailing `\r\n` after the closing `---` in the rendered body.
  let rawContent = doc.source.replace(/^---[\s\S]*?---\r?\n?/, "");

  // The page wrapper below renders `doc.fm.title` inside its own <h1>. If the
  // MDX body also leads with a `# Title` heading MDXRemote renders a second
  // h1 and the page shows two stacked titles. Strip the leading body H1 ONLY
  // when it matches the FM title after whitespace normalization — otherwise
  // a distinct body heading would be silently dropped. Mirrors the ag-ui
  // route's behavior (see app/ag-ui/[[...slug]]/page.tsx). CRLF-safe: the
  // regex uses `\r?\n` so Windows-authored MDX is handled.
  const bodyH1Match = rawContent.match(/^(\s*\r?\n)*#\s+(.+?)\s*\r?\n/);
  const bodyH1 = bodyH1Match ? bodyH1Match[2].trim() : null;
  if (bodyH1) {
    const normalizedFm = doc.fm.title.replace(/\s+/g, " ").trim();
    const normalizedBody = bodyH1.replace(/\s+/g, " ").trim();
    if (normalizedFm === normalizedBody) {
      rawContent = rawContent.replace(/^(\s*\r?\n)*#\s+.+\r?\n?/, "");
    }
  }

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
        <div style={{ paddingLeft: `${indent}px` }} key={node.slug}>
          <SidebarLink
            slug={node.slug}
            active={isActive}
            className={`block py-[5px] text-[13px] transition-colors ${
              isActive
                ? "text-[var(--accent)] font-medium"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {node.title}
          </SidebarLink>
        </div>
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
      <SidebarNav className="w-[240px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        <SidebarFrameworkSelector />
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

        {!hideBody &&
          (() => {
            const body = (
              <div className="reference-content">
                <MDXRemote
                  source={content}
                  components={{
                    ...docsComponents,
                    Snippet: (props: Record<string, unknown>) => (
                      <Snippet
                        {...(props as Record<string, string | undefined>)}
                        defaultFramework={defaultFramework}
                        defaultCell={defaultCell}
                      />
                    ),
                    InlineDemo: (props: Record<string, unknown>) => {
                      const InlineDemoComp = docsComponents.InlineDemo;
                      return (
                        <InlineDemoComp
                          {...(props as {
                            integration?: string;
                            demo?: string;
                          })}
                          integration={
                            defaultFramework ??
                            (props.integration as string | undefined)
                          }
                        />
                      );
                    },
                  }}
                  options={{
                    mdxOptions: {
                      remarkPlugins: [remarkGfm],
                      rehypePlugins: [rehypeHighlight],
                    },
                  }}
                />
              </div>
            );
            if (ContentWrapper) {
              return <ContentWrapper>{body}</ContentWrapper>;
            }
            return body;
          })()}
      </main>
    </div>
  );
}
