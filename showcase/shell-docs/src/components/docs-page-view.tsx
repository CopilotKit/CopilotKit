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
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/page";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { Snippet } from "@/components/snippet";
import { WhenFrameworkHas } from "@/components/when-framework-has";
import { Tabs as DocsTabs } from "@/components/docs-tabs";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { docsComponents } from "@/lib/mdx-registry";
import { transformerMeta } from "@/lib/rehype-code-meta";
import { getIntegration, getTabDefault } from "@/lib/registry";
import type { NavNode } from "@/lib/docs-render";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { tocHeadingsToFumadocs } from "@/lib/toc-bridge";
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

  // Bridge shell-docs's NavNode tree + headings into Fumadocs's shapes
  // so DocsLayout (sidebar) and DocsPage (right-rail TOC) can render them.
  const pageTree = navTreeToPageTree(tree, slugHrefPrefix);
  const fumadocsToc = tocHeadingsToFumadocs(tocHeadings);

  return (
    <ShellDocsLayout tree={pageTree} banner={<SidebarFrameworkSelector />}>
      <DocsPage
        toc={fumadocsToc}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
      >
        <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
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

          <DocsTitle className="text-[32px] md:text-[40px] font-medium leading-[1.2]">
            {doc.fm.title}
          </DocsTitle>
          {doc.fm.description && (
            <DocsDescription className="text-lg text-[var(--text-muted)] mt-5 mb-8 leading-relaxed">
              {doc.fm.description}
            </DocsDescription>
          )}

          {bannerSlot}

          {!hideBody &&
            (() => {
              const body = (
                <DocsBody className="reference-content">
                  <MDXRemote
                    source={content}
                    components={{
                      ...docsComponents,
                      // Wrap MDX-rendered <pre> blocks (triple-fenced code)
                      // with the same figure chrome <Snippet> uses — copy
                      // button always visible, file-path caption when the
                      // fence carries `title="..."`. The `transformerMeta`
                      // Shiki transformer (wired in `options.mdxOptions.rehypePlugins`
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
                        // Use Fumadocs's Shiki-based `rehypeCode` for
                        // syntax highlighting. Our custom `transformerMeta`
                        // surfaces the parsed fence `title="..."` and
                        // resolved language as data-attrs on the <pre>
                        // so MdxCodeBlock can render Fumadocs's CodeBlock
                        // chrome with the file-path figcaption + copy
                        // button.
                        rehypePlugins: [
                          [
                            rehypeCode,
                            {
                              fallbackLanguage: "plaintext",
                              transformers: [
                                ...(rehypeCodeDefaultOptions.transformers ??
                                  []),
                                transformerMeta(),
                              ],
                            },
                          ],
                        ],
                      },
                    }}
                  />
                </DocsBody>
              );
              if (ContentWrapper) {
                return <ContentWrapper>{body}</ContentWrapper>;
              }
              return body;
            })()}
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}
