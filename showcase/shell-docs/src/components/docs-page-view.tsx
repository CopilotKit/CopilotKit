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
import { EarlyAccessGate } from "@/components/early-access-gate";
import { getEarlyAccessGate } from "@/lib/early-access";
import {
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "@/components/ai/page-actions";
import { Snippet } from "@/components/snippet";
import { WhenFrameworkHas } from "@/components/when-framework-has";
import { Tabs as DocsTabs } from "@/components/docs-tabs";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { MdxFrameworkOverview } from "@/components/content/landing-pages/mdx-framework-overview";
import type { MdxFrameworkOverviewProps } from "@/components/content/landing-pages/mdx-framework-overview";
import { FrameworkSetup } from "@/lib/setup-concept";
import { docsComponents } from "@/lib/mdx-registry";
import { resolveDocsHref } from "@/lib/docs-link-rewrite";
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
   * `slugPath`. Used when a per-framework override backs the page (e.g.
   * BIA serves `integrations/built-in-agent/server-tools.mdx` at the
   * root URL `/server-tools`). Defaults to `slugPath`.
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
  /** Banner slot rendered at the top of the sidebar. */
  sidebarBannerSlot?: React.ReactNode;
  /** Optional class attached to the shared Fumadocs sidebar wrapper. */
  sidebarClassName?: string;
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

/**
 * Compute the public GitHub URL for an MDX source file from its absolute
 * filesystem path. `loadDoc()` returns an absolute path
 * (`/Users/.../showcase/shell-docs/src/content/docs/...mdx`); the path
 * GitHub serves is repo-relative starting from the first `showcase/`
 * segment. Falls back to `null` (no link rendered upstream is not yet
 * wired but caller passes string; treat as best-effort).
 */
function buildGitHubUrl(absFilePath: string): string {
  const marker = "/showcase/";
  const idx = absFilePath.indexOf(marker);
  // If we can't find the marker, fall back to the repo root so the
  // GitHub link is still well-formed even if it 404s — better than an
  // anchor pointing to an absolute fs path.
  const repoRelative =
    idx >= 0 ? absFilePath.slice(idx + 1) : "showcase/shell-docs";
  return `https://github.com/CopilotKit/CopilotKit/blob/main/${repoRelative}`;
}

export async function DocsPageView({
  slugPath,
  contentSlugPath,
  slugHrefPrefix,
  frameworkOverride,
  navTree,
  bannerSlot,
  sidebarBannerSlot,
  sidebarClassName,
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
    <ShellDocsLayout
      tree={pageTree}
      sidebarClassName={sidebarClassName}
      banner={
        sidebarBannerSlot === undefined ? (
          <SidebarFrameworkSelector />
        ) : (
          sidebarBannerSlot
        )
      }
    >
      <DocsPage
        toc={fumadocsToc}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
      >
        <MaybeEarlyAccessGate gate={doc.fm.earlyAccess}>
          <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
            {/* Breadcrumb styling tracks canonical fumadocs PageBreadcrumb,
             * but tighter: this should read as quiet page chrome, not a
             * second title row above the H1. */}
            <nav className="mb-2 flex flex-wrap items-center gap-1 text-[11px] font-medium leading-none text-[var(--text-muted)]">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1;
                const labelClass = `truncate ${isLast ? "text-[var(--text)] font-medium" : ""}`;
                return (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <ChevronRight
                        className="size-3 shrink-0"
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
              <DocsDescription className="text-lg text-[var(--text-muted)] mt-5 leading-relaxed">
                {doc.fm.description}
              </DocsDescription>
            )}

            {/* Page actions (Copy Markdown / Open in <LLM>) — fumadocs's
              upstream LLM page-actions feature. `markdownUrl` resolves
              through the `/:path*.mdx` rewrite to the route handler at
              `app/llms-mdx/[[...slug]]/route.ts`, which serves the raw
              MDX via the same `loadDoc()` the page uses. The GitHub URL
              is computed from `doc.filePath` (absolute fs path) by
              slicing from the `/showcase/` segment. */}
            {(() => {
              // Markdown URL = the canonical page URL with `.mdx` appended.
              // The Next.js rewrite in `next.config.ts` routes this to
              // `/llms-mdx/[[...slug]]`, which re-runs the same framework-
              // aware content resolution the page uses. Using the page URL
              // (rather than `contentSlugPath`) keeps the "View as Markdown"
              // link the user opens in a new tab visually aligned with the
              // page they're reading.
              const base = `${slugHrefPrefix || ""}/${slugPath}`
                .replace(/\/+/g, "/")
                .replace(/^\/+/, "/");
              const markdownUrl = `${base.replace(/\/$/, "")}.mdx`;
              return (
                <div className="flex min-w-0 flex-row flex-wrap gap-2 items-center my-6">
                  <MarkdownCopyButton markdownUrl={markdownUrl} />
                  <ViewOptionsPopover
                    markdownUrl={markdownUrl}
                    githubUrl={buildGitHubUrl(doc.filePath)}
                  />
                </div>
              );
            })()}

            {/* Thin divider between the page-actions row and the page body
              (banner / content). Visually separates the page metadata
              chrome (title + page actions) from the page content
              underneath. Uses the project's `--border` token so it tracks
              the rest of the page chrome in light and dark modes. */}
            <hr className="border-t border-[var(--border)] mt-2 mb-6" />

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
                              flag:
                                | "a2ui_pattern"
                                | "interrupt_pattern"
                                | "thread_persistence_pattern"
                                | "agent_config_pattern"
                                | "auth_pattern";
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
                        // Bind the URL framework slug into MdxFrameworkOverview
                        // so its link rewriter has a target to rewrite TO. The
                        // shared `integrations/<folder>/index.mdx` files
                        // (langgraph/, microsoft-agent-framework/, crewai-flows/)
                        // serve multiple URL variants — without this override the
                        // adapter's empty-slug fallback would strip the embedded
                        // framework prefix entirely (e.g. `/langgraph/quickstart`
                        // → `/quickstart`).
                        FrameworkOverview: (
                          props: MdxFrameworkOverviewProps,
                        ) => (
                          <MdxFrameworkOverview
                            {...props}
                            currentFramework={
                              frameworkOverride ?? props.currentFramework
                            }
                            hrefPrefix={slugHrefPrefix}
                          />
                        ),
                        // Same closure pattern: thread the URL framework
                        // slug into <FrameworkSetup concept="..." /> so it
                        // can resolve the per-framework concept file.
                        FrameworkSetup: (props: {
                          concept: string;
                          heading?: string | null;
                          headingId?: string;
                          currentFramework?: string;
                        }) => (
                          <FrameworkSetup
                            {...props}
                            currentFramework={
                              frameworkOverride ?? props.currentFramework
                            }
                          />
                        ),
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
                          // Spread rest BEFORE id/className so the computed
                          // slug-id always wins over any MDX-supplied id.
                          // Otherwise an authored `<h2 id="custom">` would
                          // override the slugified id, breaking the TOC's
                          // `href="#${id}"` and any inbound deep-links that
                          // already rely on the slug.
                          return (
                            <h2
                              {...rest}
                              id={id}
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
                          // Spread rest BEFORE id/className — see h2 above for
                          // rationale.
                          return (
                            <h3
                              {...rest}
                              id={id}
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
                        a: ({
                          href,
                          children,
                          ...rest
                        }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
                          <Link
                            href={
                              resolveDocsHref(href, {
                                slugHrefPrefix,
                                frameworkOverride,
                              }) ?? "#"
                            }
                            {...rest}
                          >
                            {children}
                          </Link>
                        ),
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
        </MaybeEarlyAccessGate>
      </DocsPage>
    </ShellDocsLayout>
  );
}

/**
 * Server-side gate hook-up: pages opt in via `earlyAccess: <gate-id>`
 * frontmatter. Unknown or absent gate ids render children directly so
 * ungated pages never mount the client-side gate component.
 */
function MaybeEarlyAccessGate({
  gate,
  children,
}: {
  gate?: string;
  children: React.ReactNode;
}) {
  if (!gate || !getEarlyAccessGate(gate)) return <>{children}</>;
  return <EarlyAccessGate gate={gate}>{children}</EarlyAccessGate>;
}
