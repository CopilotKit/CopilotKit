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
import { DocsPageTools, docsMarkdownUrl } from "@/components/docs-page-tools";
import { Snippet } from "@/components/snippet";
import { WhenFrameworkHas } from "@/components/when-framework-has";
import { WhenAngularBackend } from "@/components/when-angular-backend";
import type { WhenAngularBackendProps } from "@/components/when-angular-backend";
import { Tabs as DocsTabs } from "@/components/docs-tabs";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { MdxFrameworkOverview } from "@/components/content/landing-pages/mdx-framework-overview";
import type { MdxFrameworkOverviewProps } from "@/components/content/landing-pages/mdx-framework-overview";
import { OpsPlatformCTA } from "@/components/react/ops-platform-cta";
import type { OpsPlatformCTAProps } from "@/components/react/ops-platform-cta";
import { ChannelsStartPrompt } from "@/components/channels-start-prompt";
import type { ChannelsStartPromptProps } from "@/components/channels-start-prompt";
import { RichThreadsSetupPrompt } from "@/components/rich-threads-setup-prompt";
import { IntelligenceOnboardingPrompt } from "@/components/intelligence-onboarding-prompt";
import type { IntelligenceOnboardingPromptProps } from "@/components/intelligence-onboarding-prompt";
import { SignupLink } from "@/components/react/signup-link";
import type { SignupLinkProps } from "@/components/react/signup-link";
import { FrameworkSetup } from "@/lib/setup-concept";
import { docsComponents } from "@/lib/mdx-registry";
import { resolveDocsHref } from "@/lib/docs-link-rewrite";
import { transformerMeta } from "@/lib/rehype-code-meta";
import { getIntegration, getTabDefault } from "@/lib/registry";
import type { NavNode } from "@/lib/docs-render";
import type { FrontendId } from "@/lib/frontend-options";
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
  filterAngularBackendScopedBlocks,
  filterFrontendScopedBlocks,
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
  /**
   * The agent framework whose docs this page is: `slug` is the docs registry
   * slug, `name` its display name. Passing it is what puts the "Copy agent
   * prompt" button in the page-tools row, and every docs route passes it: a
   * `/<framework>/…` URL names that framework, while the root surface and the
   * cookbook name the Built-in Agent, whose lens they are.
   *
   * Deliberately separate from `frameworkOverride`, which is a content
   * concern (which framework's snippets and gated blocks to render). The two
   * answer different questions and routinely differ — a page can name a
   * framework in the prompt without resolving its content framework-scoped.
   */
  onboardingFramework?: { slug: string; name: string };
  /**
   * The frontend the page's URL selects: `id` is the docs frontend id, `name`
   * its display name. Resolved from the pathname by `onboardingFrontendFor`,
   * and named in the copied prompt right after the framework so the CLI's
   * graph has to ask for neither selection.
   *
   * Deliberately separate from `frontendOverride` below, for the same reason
   * `onboardingFramework` is separate from `frameworkOverride`: that one is a
   * content concern (which frontend's snippets to render) and is legitimately
   * absent on pages that still have a frontend selected in the URL.
   */
  onboardingFrontend?: { id: string; name: string };
  /** Frontend selected by the URL. Defaults to React on the root surface. */
  frontendOverride?: FrontendId;
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
   * The MDX for this page is itself a landing page — it brings its own
   * headline and call to action. Suppresses the docs title, the description
   * and the page-tools row, so the page has one beginning instead of two.
   * Set only by the framework-root branches in
   * `app/[framework]/[[...slug]]/page.tsx`.
   */
  landingPage?: boolean;
  /**
   * Optional client component that wraps the MDX body — used by the
   * `/docs/<feature>` router pages to conditionally hide code when no
   * framework is selected. Must accept `children` and render them
   * (or suppress them) based on its own state.
   */
  ContentWrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

function IntelligenceOnboardingPromptMdx(
  props: IntelligenceOnboardingPromptProps,
): React.JSX.Element {
  return (
    <div className="mb-6">
      <IntelligenceOnboardingPrompt {...props} />
    </div>
  );
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
  onboardingFramework,
  onboardingFrontend,
  frontendOverride,
  navTree,
  bannerSlot,
  sidebarBannerSlot,
  sidebarClassName,
  hideBody = false,
  landingPage = false,
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
  const defaultFramework = frameworkOverride ?? doc.fm.defaultFramework;
  const convertedContent = convertTablesInJSX(inlined);
  // Select the Angular quickstart's standalone/backend branch before MDX
  // compilation. RSC serialization does not preserve `selected={false}` on
  // this custom MDX component reliably, which can make the backend branch
  // render alongside the standalone BuiltInAgent instructions. The markdown
  // endpoint already applies this same source-level filter.
  const content =
    frontendOverride === "angular"
      ? filterAngularBackendScopedBlocks(convertedContent, defaultFramework)
      : convertedContent;

  const defaultCell = doc.fm.defaultCell;
  const docsFrontend = frontendOverride ?? "react";
  const docsFromPath =
    slugPath.length > 0
      ? `${slugHrefPrefix.replace(/\/$/, "")}/${slugPath}`
      : slugHrefPrefix;

  // Extract H2/H3 headings for the right-rail TOC. Run on the final
  // content (post-snippet-inlining) so a page like threads.mdx whose
  // body comes from a shared snippet still surfaces its sections.
  //
  // Filter `<WhenFrameworkHas>` branches against the active framework
  // first so the TOC only lists the headings that actually render in
  // the body. Without this, framework-gated pages like `/auth` surface
  // every per-framework variant's headings simultaneously even though
  // only one variant's body renders.
  const tocSource = filterFrontendScopedBlocks(
    filterFrameworkScopedBlocks(content, defaultFramework),
    frontendOverride,
  );
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
          <div
            className={`docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pb-6 ${
              landingPage ? "pt-0" : "pt-2 md:pt-3 xl:pt-4"
            }`}
          >
            {/* Breadcrumb styling tracks canonical fumadocs PageBreadcrumb,
             * but tighter: this should read as quiet page chrome, not a
             * second title row above the H1.
             *
             * Landing pages suppress it: the framework root has nothing to
             * navigate up to, so the trail renders as a lone framework name
             * stacked directly above the hero's own framework-name lockup. */}
            {!landingPage && (
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
            )}

            {!landingPage && (
              <>
                <DocsTitle className="text-[32px] md:text-[40px] font-medium leading-[1.2]">
                  {doc.fm.title}
                </DocsTitle>
                {doc.fm.description && (
                  <DocsDescription className="text-lg text-[var(--text-muted)] mt-5 leading-relaxed">
                    {doc.fm.description}
                  </DocsDescription>
                )}
              </>
            )}

            {/* Page actions (Copy agent prompt / Copy Markdown / Open in
              <LLM>) — fumadocs's upstream LLM page-actions feature. The
              markdown URL resolves through the `/:path*.mdx` rewrite to the
              route handler at `app/llms-mdx/[[...slug]]/route.ts`, which
              serves the raw MDX via the same `loadDoc()` the page uses. The
              GitHub URL is computed from `doc.filePath` (absolute fs path)
              by slicing from the `/showcase/` segment. */}
            {!landingPage && (
              <DocsPageTools
                slugPath={slugPath}
                slugHrefPrefix={slugHrefPrefix}
                githubUrl={buildGitHubUrl(doc.filePath)}
                onboardingFramework={onboardingFramework}
                onboardingFrontend={onboardingFrontend}
              />
            )}

            {/* Thin divider between the page-actions row and the page body
              (banner / content). Visually separates the page metadata
              chrome (title + page actions) from the page content
              underneath. Uses the project's `--border` token so it tracks
              the rest of the page chrome in light and dark modes.
              Landing pages suppress it along with the chrome it separates —
              with no title and no page-actions row above it, it would cut
              straight across the top of the hero. */}
            {!landingPage && (
              <hr className="border-t border-[var(--border)] mt-2 mb-6" />
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
                        Card: (
                          props: React.ComponentProps<
                            typeof docsComponents.Card
                          >,
                        ) => {
                          const CardComp = docsComponents.Card;
                          const href =
                            typeof props.href === "string"
                              ? resolveDocsHref(props.href, {
                                  slugHrefPrefix,
                                  frameworkOverride,
                                  frontendOverride,
                                })
                              : props.href;
                          return <CardComp {...props} href={href} />;
                        },
                        ChannelsStartPrompt: (
                          props: ChannelsStartPromptProps,
                        ) => (
                          <ChannelsStartPrompt
                            {...props}
                            frontend={props.frontend ?? docsFrontend}
                            backend={props.backend ?? onboardingFramework?.slug}
                          />
                        ),
                        RichThreadsSetupPrompt,
                        // The banner is hand-placed in MDX and cannot know
                        // which framework's page it landed on, so the map
                        // supplies it.
                        IntelligenceOnboardingPrompt: (
                          props: IntelligenceOnboardingPromptProps,
                        ) => (
                          <IntelligenceOnboardingPromptMdx
                            {...props}
                            framework={onboardingFramework}
                          />
                        ),
                        OpsPlatformCTA: (props: OpsPlatformCTAProps) => (
                          <OpsPlatformCTA
                            {...props}
                            frontend={props.frontend ?? docsFrontend}
                            backend={
                              props.backend ?? defaultFramework ?? undefined
                            }
                            fromPath={props.fromPath ?? docsFromPath}
                          />
                        ),
                        SignupLink: (props: SignupLinkProps) => (
                          <SignupLink
                            {...props}
                            frontend={props.frontend ?? docsFrontend}
                            backend={
                              props.backend ?? defaultFramework ?? undefined
                            }
                            fromPath={props.fromPath ?? docsFromPath}
                          />
                        ),
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
                        WhenAngularBackend: (
                          props: WhenAngularBackendProps,
                        ) => (
                          <WhenAngularBackend
                            {...props}
                            currentFramework={
                              frameworkOverride ?? props.currentFramework
                            }
                          />
                        ),
                        FrontendOnly: ({
                          frontend,
                          children,
                        }: {
                          frontend: FrontendId;
                          children?: React.ReactNode;
                        }) =>
                          (frontendOverride ?? "react") === frontend ? (
                            <>{children}</>
                          ) : null,
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
                            markdownUrl={docsMarkdownUrl(
                              slugHrefPrefix,
                              slugPath,
                            )}
                            onboardingFrontend={onboardingFrontend}
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
                                frontendOverride,
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
