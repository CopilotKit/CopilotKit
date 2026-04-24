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
import { DocsToc } from "@/components/docs-toc";
import { Tabs as DocsTabs } from "@/components/docs-tabs";
import { docsComponents } from "@/lib/mdx-registry";
import { getTabDefault } from "@/lib/registry";
import {
  NavNode,
  buildBreadcrumbs,
  buildNavTree,
  convertTablesInJSX,
  inlineSnippets,
  loadDoc,
  CONTENT_DIR,
} from "@/lib/docs-render";
import { childrenToText, extractHeadings, slugify } from "@/lib/toc";

export interface DocsPageViewProps {
  /** Slug path relative to `CONTENT_DIR` (no leading slash). */
  slugPath: string;
  /**
   * Optional content path to load the MDX from, when it differs from
   * `slugPath`. Used by the framework-scoped router when falling back
   * from a missing root page to a per-framework override (e.g. BIA
   * serves `integrations/built-in-agent/server-tools.mdx` at the URL
   * `/built-in-agent/server-tools`). Defaults to `slugPath`.
   */
  contentSlugPath?: string;
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
  contentSlugPath,
  slugHrefPrefix,
  frameworkOverride,
  sidebarTitle = "CopilotKit Docs",
  backLink = null,
  navTree,
  bannerSlot,
  hideBody = false,
  ContentWrapper,
}: DocsPageViewProps) {
  const doc = loadDoc(contentSlugPath ?? slugPath);
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

  // Extract H2/H3 headings for the right-rail TOC. Run on the final
  // content (post-snippet-inlining) so a page like threads.mdx whose
  // body comes from a shared snippet still surfaces its sections.
  const tocHeadings =
    hideBody || doc.fm.hideTOC ? [] : extractHeadings(content);

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
      const scope: "docs" | "framework" = slugHrefPrefix.startsWith("/docs")
        ? "docs"
        : "framework";
      return (
        <div style={{ paddingLeft: `${indent}px` }} key={node.slug}>
          <SidebarLink
            slug={node.slug}
            scope={scope}
            fallbackHref={`${slugHrefPrefix}/${node.slug}`}
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
    <div className="flex" style={{ height: "calc(100vh - 53px)" }}>
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

      {/* <main> is the full-width scroll container so the scrollbar
       * lands at the viewport (or TOC) edge. Content width is capped
       * by the inner wrapper. Previously `max-w-3xl` sat on <main>
       * directly, which parked the scrollbar mid-page. */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-8 py-8">
          <nav className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-4 flex-wrap">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="text-[var(--text-faint)]">&gt;</span>
                )}
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
                      // MDX pages author in-page variant selectors as
                      // `<Tabs groupId="language_langgraph_agent" default="Python">`.
                      // When the URL scope is a specific variant (e.g.
                      // `/langgraph-typescript/*`), pre-select the
                      // matching tab instead of the author's hardcoded
                      // default so the code visible on arrival matches
                      // the URL the user followed. Slugs without a
                      // mapping (or tabs whose groupId isn't listed in
                      // TAB_DEFAULTS_BY_SLUG) fall through to the MDX
                      // `default` and the component's first-label
                      // fallback unchanged.
                      Tabs: (props: {
                        groupId?: string;
                        default?: string;
                        items?: string[];
                        children?: React.ReactNode;
                        persist?: boolean;
                      }) => {
                        const urlDefault = getTabDefault(
                          frameworkOverride ?? null,
                          props.groupId,
                        );
                        return (
                          <DocsTabs
                            {...props}
                            default={urlDefault ?? props.default}
                          >
                            {props.children}
                          </DocsTabs>
                        );
                      },
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
                      // Inject stable IDs on H2/H3 so the right-rail TOC's
                      // #anchor links resolve. Slugify the child text with the
                      // same algorithm used by extractHeadings() so IDs line up
                      // with the TOC entries.
                      h2: ({
                        children,
                        ...rest
                      }: React.HTMLAttributes<HTMLHeadingElement>) => (
                        <h2 id={slugify(childrenToText(children))} {...rest}>
                          {children}
                        </h2>
                      ),
                      h3: ({
                        children,
                        ...rest
                      }: React.HTMLAttributes<HTMLHeadingElement>) => (
                        <h3 id={slugify(childrenToText(children))} {...rest}>
                          {children}
                        </h3>
                      ),
                      // When rendering under a framework-scoped route, rewrite
                      // root-relative MDX links (/quickstart, /shared-state, …)
                      // to the framework-scoped equivalent so clicks never land
                      // on the unscoped page and trigger a RouterPivot redirect.
                      ...(frameworkOverride && {
                        a: ({
                          href,
                          children,
                          ...rest
                        }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
                          const resolved =
                            href?.startsWith("/") &&
                            !href.startsWith(`/${frameworkOverride}/`)
                              ? `/${frameworkOverride}${href}`
                              : href;
                          return (
                            <Link href={resolved ?? "#"} {...rest}>
                              {children}
                            </Link>
                          );
                        },
                      }),
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
        </div>
      </main>

      <DocsToc headings={tocHeadings} />
    </div>
  );
}
