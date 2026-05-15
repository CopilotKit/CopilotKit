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
import { ChevronRight } from "lucide-react";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { SidebarNav } from "@/components/sidebar-nav";
import { SidebarLink } from "@/components/sidebar-link";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { Snippet } from "@/components/snippet";
import { WhenFrameworkHas } from "@/components/when-framework-has";
import { DocsToc } from "@/components/docs-toc";
import { Tabs as DocsTabs } from "@/components/docs-tabs";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { docsComponents } from "@/lib/mdx-registry";
import { rehypeCodeMeta } from "@/lib/rehype-code-meta";
import { getIntegration, getTabDefault } from "@/lib/registry";
import type { NavNode } from "@/lib/docs-render";
import {
  buildBreadcrumbs,
  buildNavTree,
  convertTablesInJSX,
  inlineSnippets,
  loadDoc,
  CONTENT_DIR,
} from "@/lib/docs-render";
import {
  childrenToText,
  extractHeadings,
  filterFrameworkScopedBlocks,
  slugify,
} from "@/lib/toc";

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

  const defaultFramework = frameworkOverride ?? doc.fm.defaultFramework;
  const defaultCell = doc.fm.defaultCell;

  // Extract H2/H3 headings for the right-rail TOC. Run on the final
  // content (post-snippet-inlining) so a page like threads.mdx whose
  // body comes from a shared snippet still surfaces its sections.
  //
  // Filter `<WhenFrameworkHas>` branches against the active framework
  // first so the TOC only lists the headings that actually render in
  // the body. Without this, framework-gated pages like `/auth` surface
  // every per-framework variant's headings simultaneously even though
  // only one variant's body renders.
  const tocSource = filterFrameworkScopedBlocks(content, defaultFramework);
  const tocHeadings =
    hideBody || doc.fm.hideTOC ? [] : extractHeadings(tocSource);

  const tree = navTree ?? buildNavTree(CONTENT_DIR);
  // Breadcrumb root label tracks the framework whose content is being
  // rendered. On framework-scoped pages this reads "LangGraph (Python)";
  // on unscoped pages it falls back to "Docs". The sidebar no longer
  // surfaces this label as a separate link — the selector pill at the
  // top of the sidebar already names the framework.
  const rootLabel =
    (frameworkOverride && getIntegration(frameworkOverride)?.name) || "Docs";
  const breadcrumbs = buildBreadcrumbs(slugPath, {
    rootLabel,
    rootHref: slugHrefPrefix || "/",
    slugHrefPrefix,
  });

  function renderNavItem(node: NavNode, depth: number = 0): React.ReactNode {
    if (node.type === "section") {
      // Nested sections (depth > 0) are inline subsection labels inside
      // a parent group — small, no divider rule, no shouty banner. The
      // top-level section banner already names the parent area, so a
      // second full-size banner one level in reads as redundant.
      if (depth > 0) {
        return (
          <div
            key={`section-${node.title}`}
            className="px-3 mt-4 mb-1 text-[11px] uppercase tracking-wide text-[var(--text-faint)]"
          >
            {node.title}
          </div>
        );
      }
      return (
        <div
          key={`section-${node.title}`}
          className="flex items-center gap-2 mt-6 mb-3"
        >
          <span className="text-[15px] uppercase tracking-wide shrink-0 text-[var(--text-secondary)]">
            {node.title}
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>
      );
    }
    if (node.type === "page") {
      const isActive = node.slug === slugPath;
      const scope: "docs" | "framework" = slugHrefPrefix.startsWith("/docs")
        ? "docs"
        : "framework";
      return (
        <SidebarLink
          key={node.slug}
          slug={node.slug}
          scope={scope}
          fallbackHref={`${slugHrefPrefix}/${node.slug}`}
          active={isActive}
          className={`flex items-center h-10 px-3 text-sm rounded-lg shrink-0 transition-all duration-200 ${
            isActive
              ? "bg-[var(--bg-surface)] text-[var(--text)] shadow-sm dark:bg-[var(--bg-hover)] dark:shadow-none dark:ring-1 dark:ring-white/10"
              : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]/60 hover:text-[var(--text)] dark:hover:bg-white/5"
          }`}
        >
          {node.title}
        </SidebarLink>
      );
    }
    // Group: a labeled folder with nested children. When the group has
    // a visible title, render its children with an indent + vertical
    // guide line (border-l) — the tree-connector look from the
    // canonical docs sidebar. Title-less wrapper groups (used to flatten
    // a section's content) skip the indent.
    const hasTitle = !!node.title;
    return (
      <div key={`group-${node.slug}`} className="mt-1">
        {hasTitle && (
          <div className="flex items-center h-10 px-3 text-sm font-medium text-[var(--text)] shrink-0">
            {node.title}
          </div>
        )}
        <div
          className={
            hasTitle
              ? "ml-3 pl-3 border-l border-[var(--border-dim)] flex flex-col"
              : "flex flex-col"
          }
        >
          {node.children.map((child) => renderNavItem(child, depth + 1))}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Canonical layout: sidebar is a flex sibling of the scrolling
       * content wrapper. The parent <main> in app/layout.tsx supplies
       * the horizontal flex row (and the page-bg margin around it),
       * so we only own column geometry here. Inner nav scrolls when
       * the tree exceeds available height; the framework selector
       * stays pinned at the top of the column via its own sticky. */}
      <SidebarNav className="hidden md:flex flex-col w-[260px] shrink-0 rounded-l-2xl backdrop-blur-lg border border-r-0 border-[var(--border)] bg-[var(--glass-background)] overflow-hidden px-3">
        <SidebarFrameworkSelector />
        <div className="mb-4" />
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {tree.map((node) => renderNavItem(node))}
        </div>
      </SidebarNav>

      {/* The ONLY scroll container in the docs view (see globals.css
       * `.docs-content-wrapper`). The right-rail TOC lives inside this
       * wrapper so it sees the same near-white surface, sticks within
       * this scroll context, and doesn't bleed onto the page-bg gray. */}
      <div className="docs-content-wrapper flex">
        {/* Padding + cap mirror canonical docs.copilotkit.ai's article
         * column: `px-4 py-6 md:px-6 md:pt-8 xl:px-8 xl:pt-14` outside,
         * `max-w-[900px] mx-auto` inside. mx-auto centers the column when
         * the available area exceeds 900px so content sits between sidebar
         * and TOC the same way it does on the canonical site, instead of
         * left-anchored with a wide right gap. */}
        <div className="flex-1 min-w-0 px-4 py-6 md:px-6 md:pt-8 xl:px-8 xl:pt-14">
          <div className="max-w-[900px] mx-auto">
            {/* Breadcrumb styling tracks canonical fumadocs PageBreadcrumb:
             * text-sm with a ChevronRight separator, intermediate links
             * muted, last segment in primary text + medium weight. */}
            <nav className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] mb-4 flex-wrap">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                const labelClass = `truncate ${isLast ? "text-[var(--text)] font-medium" : ""}`;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <ChevronRight
                        className="size-3.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className={`${labelClass} transition-opacity hover:opacity-80`}
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className={labelClass}>{crumb.label}</span>
                    )}
                  </React.Fragment>
                );
              })}
            </nav>

            {/* Title + description spacing mirrors canonical: gap-5
             * between the H1 and the description, then `mb-8` (32px)
             * before the body. Canonical's first prose paragraph also
             * uses mb-8 — anything bigger reads as a hole between the
             * header block and the article. Title sizes scale from
             * 32px to 40px at md+ to match docs.copilotkit.ai. */}
            <div className="flex flex-col gap-5">
              <h1 className="text-[32px] md:text-[40px] font-medium text-[var(--text)] leading-[1.2]">
                {doc.fm.title}
              </h1>
              {doc.fm.description && (
                <p className="text-lg text-[var(--text-muted)] mb-8 leading-relaxed">
                  {doc.fm.description}
                </p>
              )}
            </div>

            {bannerSlot}

            {!hideBody &&
              (() => {
                const body = (
                  <div className="reference-content">
                    <MDXRemote
                      source={content}
                      components={{
                        ...docsComponents,
                        // Wrap MDX-rendered <pre> blocks (triple-fenced code)
                        // with the same figure chrome <Snippet> uses — copy
                        // button always visible, file-path caption when the
                        // fence carries `title="..."`. The rehypeCodeMeta
                        // plugin (wired in `options.mdxOptions.rehypePlugins`
                        // below) is what puts `data-title` / `data-language`
                        // on the <pre> for this component to read.
                        pre: MdxCodeBlock,
                        Snippet: (props: Record<string, unknown>) => (
                          <Snippet
                            {...(props as Record<string, string | undefined>)}
                            defaultFramework={defaultFramework}
                            defaultCell={defaultCell}
                          />
                        ),
                        WhenFrameworkHas: (props: Record<string, unknown>) => (
                          <WhenFrameworkHas
                            {...(props as {
                              flag: "a2ui_pattern" | "interrupt_pattern";
                              equals?: string;
                              absent?: boolean;
                              framework?: string;
                              children?: React.ReactNode;
                            })}
                            defaultFramework={defaultFramework}
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
                        // H2/H3 carry stable slug IDs (already used by the
                        // right-rail TOC) and now also surface a hover-only
                        // `#` anchor link for deep-linking, mirroring the
                        // canonical fumadocs prose chrome.
                        h2: ({
                          children,
                          ...rest
                        }: React.HTMLAttributes<HTMLHeadingElement>) => {
                          const id = slugify(childrenToText(children));
                          return (
                            <h2
                              id={id}
                              {...rest}
                              className={`docs-heading group ${rest.className ?? ""}`}
                            >
                              {children}
                              <a
                                href={`#${id}`}
                                aria-label="Link to this section"
                                className="docs-heading-anchor"
                              >
                                #
                              </a>
                            </h2>
                          );
                        },
                        h3: ({
                          children,
                          ...rest
                        }: React.HTMLAttributes<HTMLHeadingElement>) => {
                          const id = slugify(childrenToText(children));
                          return (
                            <h3
                              id={id}
                              {...rest}
                              className={`docs-heading group ${rest.className ?? ""}`}
                            >
                              {children}
                              <a
                                href={`#${id}`}
                                aria-label="Link to this section"
                                className="docs-heading-anchor"
                              >
                                #
                              </a>
                            </h3>
                          );
                        },
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
                          // `rehypeCodeMeta` runs AFTER rehype-highlight so
                          // it sees the `language-<name>` className the
                          // highlighter pushes onto the <code> element, and
                          // can surface both that and the original fence
                          // metastring (`title="..."`) as data-attrs on the
                          // <pre>. The MdxCodeBlock `pre` override below
                          // reads those data-attrs to render a copy button
                          // + file-path caption.
                          rehypePlugins: [rehypeHighlight, rehypeCodeMeta],
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
        </div>

        <DocsToc headings={tocHeadings} />
      </div>
    </>
  );
}
