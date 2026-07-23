// /<framework>/<...slug> — framework-scoped docs route.
//
// Example URLs:
//   /langgraph-python                       → framework landing page
//   /langgraph-python/agentic-chat-ui       → the Agentic Chat UI docs
//                                             with snippets resolved from
//                                             the `langgraph-python`
//                                             integration's cells
//   /mastra/generative-ui/tool-rendering    → tool rendering docs scoped
//                                             to the `mastra` cells
//
// The first URL segment is validated against the registry's list of
// integration slugs. When it doesn't match, we fall through to
// UnscopedDocsPage so unscoped doc slugs (e.g. /quickstart) are served
// correctly even though Next.js routes them here before [[...slug]].

import React from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import {
  rehypeCode,
  rehypeCodeDefaultOptions,
} from "fumadocs-core/mdx-plugins";
import { ShellDocsLayout } from "@/components/shell-docs-layout";
import { DocsPage } from "fumadocs-ui/page";
import { navTreeToPageTree } from "@/lib/page-tree-bridge";
import { DocsPageView } from "@/components/docs-page-view";
import { MdxCodeBlock } from "@/components/mdx-code-block";
import { SidebarFrameworkSelector } from "@/components/sidebar-framework-selector";
import { UnscopedDocsPage } from "@/components/unscoped-docs-page";
import { FrameworkOverview } from "@/components/content/landing-pages/framework-overview";
import { MdxFrameworkOverview } from "@/components/content/landing-pages/mdx-framework-overview";
import type { MdxFrameworkOverviewProps } from "@/components/content/landing-pages/mdx-framework-overview";
import { FrameworkSetup } from "@/lib/setup-concept";
import { frameworkOverviews } from "@/data/frameworks";
import {
  getAngularDocsNavTree,
  resolveAngularDoc,
} from "@/lib/angular-doc-navigation";
import { docsComponents } from "@/lib/mdx-registry";
import { resolveFrontendDocPage } from "@/lib/frontend-doc-policy";
import {
  getFrontendGuidanceContentSlug,
  getFrontendContentSlug,
  getFrontendCanonicalSlug,
  getFrontendQuickstartNavTree,
} from "@/lib/frontend-page-content";
import type { FrontendPageId } from "@/lib/frontend-page-content";
import {
  frontendPathForBackend,
  getFrontendOption,
  isFrontendId,
  parseFrontendRoutePath,
} from "@/lib/frontend-options";
import { transformerMeta } from "@/lib/rehype-code-meta";
import {
  CONTENT_DIR,
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  findFrameworksWithCell,
  findFrameworksWithPage,
  loadDoc,
} from "@/lib/docs-render";
import type { NavNode } from "@/lib/docs-render";
import {
  getDocsFolder,
  getDocsMode,
  getIntegration,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "@/lib/registry";
import { buildDocMetadata } from "@/lib/seo-metadata";
import { RESERVED_ROUTE_SLUGS } from "@/lib/reserved-route-slugs";
import demoContent from "@/data/demo-content.json";
import fs from "fs";
import path from "path";

const DOCS_ONLY_FRAMEWORK_SLUGS = new Set(["a2a", "agent-spec", "deepagents"]);

function hasDocsOnlyFrameworkContent(framework: string): boolean {
  if (!DOCS_ONLY_FRAMEWORK_SLUGS.has(framework)) return false;
  return (
    frameworkOverviews[framework] !== undefined ||
    fs.existsSync(path.join(CONTENT_DIR, "integrations", framework))
  );
}

function isFrontendPageId(value: string): value is FrontendPageId {
  return isFrontendId(value) && value !== "react";
}

function frontendRoutePath(
  frontend: FrontendPageId,
  slugPath: string,
  activeBackendFramework: string | null = null,
): string {
  return frontendPathForBackend(frontend, slugPath, activeBackendFramework);
}

function isFrontendGuidanceSlug(slugPath: string): boolean {
  return slugPath === "using-these-docs";
}

function isFrontendRootSlug(slugPath: string): boolean {
  return !slugPath || slugPath === "quickstart";
}

function reactRootPath(slugPath: string): string {
  return frontendPathForBackend("react", slugPath);
}

function scopedRoutePath(slugHrefPrefix: string, slugPath: string): string {
  const prefix = slugHrefPrefix.replace(/\/+$/, "");
  const normalizedSlugPath = slugPath.split("/").filter(Boolean).join("/");
  if (!normalizedSlugPath) return prefix || "/";
  return `${prefix}/${normalizedSlugPath}`;
}

function legacyFrontendPathRedirect(
  activeBackendFramework: string,
  slugPath: string,
): string | null {
  const [frontendsSegment, frontend, ...tail] = slugPath
    .split("/")
    .filter(Boolean);
  if (frontendsSegment !== "frontends" || !isFrontendId(frontend)) {
    return null;
  }

  return frontendPathForBackend(
    frontend,
    tail.join("/"),
    activeBackendFramework,
  );
}

function frontendMetadata(
  frontend: FrontendPageId,
  slugPath: string,
  activeBackendFramework: string | null = null,
): Metadata {
  if (!slugPath || slugPath === "quickstart") {
    const contentSlug = getFrontendContentSlug(frontend);
    const doc = loadDoc(contentSlug);
    const option = getFrontendOption(frontend);

    return buildDocMetadata({
      title: `${doc?.fm.title ?? option.name} quickstart`,
      description: doc?.fm.description,
      canonicalPath: frontendRoutePath(frontend, "", activeBackendFramework),
    });
  }

  if (slugPath === "using-these-docs") {
    const doc = loadDoc(getFrontendGuidanceContentSlug(frontend));
    const option = getFrontendOption(frontend);

    return buildDocMetadata({
      title: `${option.name}: ${doc?.fm.title ?? "using these docs"}`,
      description: doc?.fm.description,
      canonicalPath: frontendRoutePath(
        frontend,
        slugPath,
        activeBackendFramework,
      ),
    });
  }

  const resolution = resolveFrontendDocPage(frontend, slugPath);
  const doc =
    resolution.status === "found" ? loadDoc(resolution.contentSlugPath) : null;

  return buildDocMetadata({
    title: doc?.fm.title ?? slugPath,
    description: doc?.fm.description,
    canonicalPath:
      resolution.status === "found"
        ? frontendRoutePath(
            frontend,
            resolution.slugPath,
            activeBackendFramework,
          )
        : frontendRoutePath(frontend, slugPath, activeBackendFramework),
  });
}

function frameworkMetadata(
  framework: string,
  slugPath: string,
  canonicalPath = slugPath ? `/${framework}/${slugPath}` : `/${framework}`,
): Metadata {
  // Try to read frontmatter for the resolved page. Mirror the page's
  // own content-resolution order (authored vs generated, per-framework
  // override vs root) cheaply: best-effort only; if nothing resolves,
  // the helper falls back to the framework slug as a humanised title.
  let title: string | undefined;
  let description: string | undefined;
  const integration = getIntegration(framework);
  const isDocsOnlyFramework =
    !integration && hasDocsOnlyFrameworkContent(framework);
  if (!integration && !isDocsOnlyFramework) {
    // Root-surface URL. The BIA-authored page wins when one exists —
    // mirror UnscopedDocsPage's resolution so the metadata matches the
    // content the route serves.
    const unscopedPath = [
      framework,
      ...slugPath.split("/").filter(Boolean),
    ].join("/");
    const doc =
      loadDoc(
        `integrations/${getDocsFolder(ROOT_FRAMEWORK)}/${unscopedPath}`,
      ) ?? loadDoc(unscopedPath);
    title = doc?.fm.title ?? humanizeSlug(unscopedPath);
    description = doc?.fm.description;
  } else if (slugPath) {
    const docsFolder = getDocsFolder(framework);
    const frameworkScopedDoc = loadDoc(
      `integrations/${docsFolder}/${slugPath}`,
    );
    const doc = frameworkScopedDoc ?? loadDoc(slugPath);
    if (doc) {
      title = doc.fm.title;
      description = doc.fm.description;
    }
  } else {
    // Framework root — prefer the integration record's display name and
    // tagline, falling back to the framework's index.mdx if present.
    const overview = frameworkOverviews[framework];
    const indexDoc = loadDoc(`integrations/${getDocsFolder(framework)}/index`);
    title =
      indexDoc?.fm.title ??
      overview?.frameworkName ??
      integration?.name ??
      framework;
    description = indexDoc?.fm.description ?? overview?.subheader;
  }

  // Per-page OG route lives at /og/<slug>/og.png — see
  // src/app/og/[...slug]/route.tsx. Each framework variant gets its own
  // image because the slug is framework-scoped.
  const ogPath = `/og${canonicalPath}/og.png`;
  return buildDocMetadata({
    title: title ?? framework,
    description,
    canonicalPath,
    ogPath,
  });
}

// Per-framework self-canonical: /<framework>/<slug> declares itself
// canonical (NOT the bare /<slug>) so search engines index each
// framework variant at its own URL. When the URL's first segment
// doesn't match a registered integration, the route falls through to
// UnscopedDocsPage but the canonical still points at the same URL —
// the page's identity is defined by its URL, not the resolution
// strategy used to render it.
//
// Title and description come from the resolved MDX frontmatter (with
// the same per-framework override resolution the page render uses) so
// every variant emits its own social card and SEO description rather
// than inheriting the layout's generic site-wide values.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ framework: string; slug?: string[] }>;
}): Promise<Metadata> {
  const { framework, slug } = await params;
  const slugPath = slug?.join("/") ?? "";

  if (framework === "react") {
    const canonicalPath = reactRootPath(slugPath);
    const doc = slugPath
      ? (loadDoc(`integrations/${getDocsFolder(ROOT_FRAMEWORK)}/${slugPath}`) ??
        loadDoc(slugPath))
      : null;

    return buildDocMetadata({
      title: doc?.fm.title ?? (slugPath || "CopilotKit docs"),
      description: doc?.fm.description,
      canonicalPath,
      ogPath: `/og${canonicalPath}/og.png`,
    });
  }

  if (isFrontendPageId(framework)) {
    const frontendRoute = parseFrontendRoutePath(
      `/${[framework, ...(slug ?? [])].join("/")}`,
      getIntegrations().map((integration) => integration.slug),
    );
    const activeBackendFramework =
      frontendRoute?.backend === ROOT_FRAMEWORK
        ? null
        : (frontendRoute?.backend ?? null);
    const activeFrontendSlugPath = frontendRoute?.slugPath ?? slugPath;
    if (isFrontendGuidanceSlug(activeFrontendSlugPath)) {
      return frontendMetadata(
        framework,
        activeFrontendSlugPath,
        activeBackendFramework,
      );
    }

    if (!activeBackendFramework && isFrontendRootSlug(activeFrontendSlugPath)) {
      return frontendMetadata(framework, "", activeBackendFramework);
    }

    if (framework === "angular" && activeFrontendSlugPath === "quickstart") {
      return frontendMetadata(
        framework,
        activeFrontendSlugPath,
        activeBackendFramework,
      );
    }

    if (activeBackendFramework) {
      const slugHrefPrefix = frontendRoutePath(
        framework,
        "",
        activeBackendFramework,
      );
      return frameworkMetadata(
        activeBackendFramework,
        activeFrontendSlugPath,
        scopedRoutePath(slugHrefPrefix, activeFrontendSlugPath),
      );
    }

    return frontendMetadata(
      framework,
      activeFrontendSlugPath,
      activeBackendFramework,
    );
  }

  return frameworkMetadata(framework, slugPath);
}

export async function generateStaticParams() {
  // Rely on the catch-all's dynamic behaviour at runtime; returning an
  // empty array keeps build times short since there are ~17 frameworks
  // × ~60 doc pages, all cheap to render on demand.
  return [];
}

// Force dynamic rendering so paths NOT in generateStaticParams are
// rendered fresh on each request. Without this, Next.js was caching
// the rendered "404 page body" with a 200 status and `s-maxage=1y`
// (a soft-404 that demotes the whole site in search rankings). With
// `force-dynamic`, the runtime notFound() call sets the response
// status to 404 every time. The data fetches here are filesystem
// reads of MDX, so per-request rendering is cheap.
export const dynamic = "force-dynamic";

interface DemoRecord {
  regions?: Record<string, unknown>;
}
const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

/**
 * Heuristic: does this framework have ANY region tagged for the given
 * feature slug? Used to render a clear "not available" banner when an
 * MDX page's snippet_cell points at a cell that doesn't exist for the
 * currently selected framework.
 */
function frameworkHasCellFor(framework: string, cell: string): boolean {
  return Boolean(demos[`${framework}::${cell}`]);
}

export default async function FrameworkScopedDocsPage({
  params,
}: {
  params: Promise<{ framework: string; slug?: string[] }>;
}) {
  const { framework, slug } = await params;

  // Defense in depth: explicitly 404 on reserved top-level route slugs.
  // Next.js already prefers exact-match routes over this catch-all, so
  // `/docs`, `/ag-ui`, etc. never reach here during normal routing.
  // But if the registry ever ships an integration whose slug collides
  // with a reserved segment, layout.tsx drops it from knownFrameworks
  // AND this guard ensures the route handler still short-circuits to a
  // clean 404 rather than rendering garbage.
  if ((RESERVED_ROUTE_SLUGS as readonly string[]).includes(framework)) {
    notFound();
  }

  const frontendSlugPath = slug?.join("/") ?? "";
  if (framework === "frontends") {
    const [frontend, ...tail] = slug ?? [];
    if (isFrontendId(frontend)) {
      redirect(frontendPathForBackend(frontend, tail.join("/")));
    }

    redirect(frontendSlugPath ? `/${frontendSlugPath}` : "/");
  }

  if (framework === "react") {
    redirect(reactRootPath(frontendSlugPath));
  }

  let scopedFramework = framework;
  let scopedSlug = slug;
  let scopedSlugHrefPrefix: string | null = null;
  let activeFrontendPage: FrontendPageId | null = null;

  if (isFrontendPageId(framework)) {
    activeFrontendPage = framework;
    const frontendRoute = parseFrontendRoutePath(
      `/${[framework, ...(slug ?? [])].join("/")}`,
      getIntegrations().map((integration) => integration.slug),
    );
    const activeBackendFramework = frontendRoute?.backend ?? null;
    const requestedFrontendSlugPath =
      frontendRoute?.slugPath ?? frontendSlugPath;
    const activeFrontendSlugPath = getFrontendCanonicalSlug(
      framework,
      requestedFrontendSlugPath,
    );

    if (activeFrontendSlugPath !== requestedFrontendSlugPath) {
      redirect(
        frontendRoutePath(
          framework,
          activeFrontendSlugPath,
          activeBackendFramework,
        ),
      );
    }

    if (activeBackendFramework === ROOT_FRAMEWORK) {
      redirect(frontendRoutePath(framework, activeFrontendSlugPath));
    }

    if (
      activeBackendFramework &&
      getDocsMode(activeBackendFramework) === "hidden"
    ) {
      notFound();
    }

    if (!activeFrontendSlugPath) {
      if (framework === "angular" && activeBackendFramework) {
        return (
          <FrameworkRootPage
            framework={activeBackendFramework}
            preferIndexMdx
            slugHrefPrefix={frontendRoutePath(
              framework,
              "",
              activeBackendFramework,
            )}
            navTreeOverride={getAngularDocsNavTree(activeBackendFramework)}
            sidebarBannerSlot={<FrontendSidebarBanner frontend={framework} />}
          />
        );
      }

      return (
        <FrontendQuickstartDocsPage
          frontend={framework}
          activeBackendFramework={activeBackendFramework}
          navTree={
            framework === "angular"
              ? getAngularDocsNavTree(activeBackendFramework)
              : undefined
          }
        />
      );
    }

    if (activeFrontendSlugPath === "quickstart") {
      if (framework === "angular" && activeBackendFramework) {
        return (
          <FrontendQuickstartDocsPage
            frontend={framework}
            activeBackendFramework={activeBackendFramework}
            routeSlugPath="quickstart"
            navTree={getAngularDocsNavTree(activeBackendFramework)}
          />
        );
      }
      redirect(frontendRoutePath(framework, "", activeBackendFramework));
    }

    if (isFrontendGuidanceSlug(activeFrontendSlugPath)) {
      return (
        <FrontendGuidanceDocsPage
          frontend={framework}
          activeBackendFramework={activeBackendFramework}
          navTree={
            framework === "angular"
              ? getAngularDocsNavTree(activeBackendFramework)
              : undefined
          }
        />
      );
    }

    if (framework === "angular") {
      const resolution = resolveAngularDoc(
        activeBackendFramework,
        activeFrontendSlugPath,
      );
      if (!resolution) notFound();

      return (
        <DocsPageView
          slugPath={resolution.slugPath}
          contentSlugPath={resolution.contentSlugPath}
          slugHrefPrefix={frontendRoutePath(
            framework,
            "",
            activeBackendFramework,
          )}
          frameworkOverride={resolution.framework}
          navTree={getAngularDocsNavTree(activeBackendFramework)}
          sidebarBannerSlot={<FrontendSidebarBanner frontend={framework} />}
        />
      );
    }

    if (activeBackendFramework) {
      scopedFramework = activeBackendFramework;
      scopedSlug = activeFrontendSlugPath
        ? activeFrontendSlugPath.split("/").filter(Boolean)
        : undefined;
      scopedSlugHrefPrefix = frontendRoutePath(
        framework,
        "",
        activeBackendFramework,
      );
    } else {
      const resolution = resolveFrontendDocPage(
        framework,
        activeFrontendSlugPath,
      );
      if (resolution.status === "not-found") notFound();

      return (
        <DocsPageView
          slugPath={resolution.slugPath}
          contentSlugPath={resolution.contentSlugPath}
          slugHrefPrefix={frontendRoutePath(
            framework,
            "",
            activeBackendFramework,
          )}
          frameworkOverride={activeBackendFramework}
          navTree={getFrontendQuickstartNavTree(framework)}
          sidebarBannerSlot={<FrontendSidebarBanner frontend={framework} />}
        />
      );
    }
  }

  // Validate the framework slug against the registry.
  // If not a registered integration, treat the URL as an unscoped doc path.
  // This is necessary because Next.js routes /quickstart here (dynamic segment
  // beats optional catch-all) before [[...slug]] ever sees it.
  //
  // Exception: docs-only frameworks (`a2a`, `agent-spec`, `deepagents`) have a
  // `frameworkOverviews` entry and/or content under `integrations/<slug>/`
  // but no demo package in `showcase/integrations/`, so they're absent from
  // the registry. Recognize them by slug so the framework-root page (Tier 1
  // FrameworkOverview / Tier 2 MDX index) can still render.
  const integration = getIntegration(scopedFramework);
  const isDocsOnlyFramework =
    !integration && hasDocsOnlyFrameworkContent(scopedFramework);
  if (!integration && !isDocsOnlyFramework) {
    const unscopedPath = [scopedFramework, ...(scopedSlug ?? [])].join("/");
    return <UnscopedDocsPage slugPath={unscopedPath} />;
  }

  // `docs_mode: hidden` (manifest.yaml) means the framework should not
  // appear in shell-docs at all — no `/<slug>` page, no switcher entry.
  // 404 is the right answer; the unscoped fallback above would still
  // show the user the agnostic docs under their framework slug, which
  // misleadingly implies the framework has docs.
  if (integration && getDocsMode(scopedFramework) === "hidden") {
    notFound();
  }

  const slugPath = scopedSlug?.join("/") ?? "";
  const frontendRedirect = legacyFrontendPathRedirect(
    scopedFramework,
    slugPath,
  );
  if (frontendRedirect) redirect(frontendRedirect);

  // No slug → framework landing page. Three-tier resolution:
  //   1. Data-driven `FrameworkOverview` when a record exists in
  //      `frameworkOverviews` (13 frameworks).
  //   2. MDX-authored `integrations/<folder>/index.mdx` when present
  //      (built-in-agent + deepagents are fully free-form).
  //   3. Fallback: 404. Every registered integration is expected to
  //      have either a data record OR an index.mdx after Phase 2; a
  //      missing entry is an authoring error worth surfacing.
  if (!slugPath) {
    return (
      <FrameworkRootPage
        framework={scopedFramework}
        preferIndexMdx={Boolean(scopedSlugHrefPrefix)}
        slugHrefPrefix={scopedSlugHrefPrefix ?? `/${scopedFramework}`}
      />
    );
  }

  // `/<framework>/unselected/<path>` is incoherent — a framework IS
  // selected, so the URL should never assert the "unselected" state
  // alongside. Collapse to the framework-scoped path (which serves the
  // same underlying content, just with Snippets resolved against the
  // selected framework's cells).
  if (slugPath.startsWith("unselected/")) {
    redirect(
      `${scopedSlugHrefPrefix ?? `/${scopedFramework}`}/${slugPath.slice(
        "unselected/".length,
      )}`,
    );
  }

  // Content resolution:
  //   1. Root MDX — framework-agnostic page rendered with this
  //      framework's override (Model 1, the primary path).
  //   2. Per-framework override at `integrations/<framework>/<slug>.mdx`
  //      — topics that are genuinely framework-specific (e.g. BIA's
  //      `server-tools`) and have no root equivalent. When this path
  //      wins, we record it as `contentSlugPath` so DocsPageView loads
  //      from there while the URL slug continues driving breadcrumbs
  //      and active-link detection.
  //   3. If the slug exists for *other* frameworks but not this one,
  //      render a "not available for <framework>" fallback inside the
  //      docs shell (handled below, after the nav is built).
  //   4. Otherwise 404.
  // Most registry slugs map 1:1 to a folder under `integrations/`, but
  // language/runtime variants share a single docs folder:
  // langgraph-python/typescript/fastapi → `langgraph/`, ms-agent-dotnet/
  // python → `microsoft-agent-framework/`, plus legacy renames for
  // google-adk → `adk/` and strands → `aws-strands/`. Resolve the URL
  // slug to its docs folder before touching disk.
  const docsFolder = getDocsFolder(scopedFramework);
  const docsMode = getDocsMode(scopedFramework);
  const frameworkName =
    integration?.name ??
    frameworkOverviews[scopedFramework]?.frameworkName ??
    scopedFramework;

  let contentSlugPath: string = slugPath;
  let doc: ReturnType<typeof loadDoc> = null;

  // Content resolution order depends on docs_mode:
  //
  //   authored  — per-framework MDX wins for every slug. Authored pages
  //               can replace root pages while keeping the framework's
  //               authored sidebar IA.
  //               Only fall back to root if the framework simply has no
  //               file for the requested slug (preserves the "shared"
  //               fallback for slugs the framework intentionally leaves
  //               to the agnostic page, e.g. enterprise CTAs).
  //   generated — root MDX wins (Model 1, current behavior); the
  //               per-framework tree is a sparse override layer.
  if (docsMode === "authored") {
    const frameworkPath = `integrations/${docsFolder}/${slugPath}`;
    doc = loadDoc(frameworkPath);
    if (doc) contentSlugPath = frameworkPath;
    if (!doc) doc = loadDoc(slugPath);
  } else {
    // A few root pages are shared nav shims/overviews whose framework-scoped
    // URLs should render the per-framework MDX when it exists.
    //
    // - `/quickstart` at the root is a routing shim; real quickstart content
    //   lives per-framework.
    // - `/threads-import` is a cross-source overview at the root, but ADK and
    //   LangGraph have source-specific import guides at the same framework URL.
    if (slugPath === "quickstart" || slugPath === "threads-import") {
      const overridePath = `integrations/${docsFolder}/${slugPath}`;
      doc = loadDoc(overridePath);
      if (doc) contentSlugPath = overridePath;
    }
    if (!doc) {
      doc = loadDoc(slugPath);
      if (!doc) {
        const fallbackPath = `integrations/${docsFolder}/${slugPath}`;
        doc = loadDoc(fallbackPath);
        if (doc) contentSlugPath = fallbackPath;
      }
    }
  }

  // Authored integrations own their full docs tree and sidebar IA.
  // Generated integrations use the root docs IA with a sparse
  // framework-specific override section.
  const navTree: NavNode[] =
    docsMode === "authored"
      ? buildFrameworkOnlyNav(docsFolder)
      : buildFrameworkNav(docsFolder, frameworkName, scopedFramework);

  if (!doc) {
    // No root MDX and no override for this framework. If the topic
    // exists for *other* frameworks (e.g. a BIA-specific page like
    // `/mastra/advanced-configuration`), render a fallback inside the
    // docs shell that lists the frameworks where it does exist — the
    // user keeps their framework context and gets a clear path
    // forward. Only 404 when the slug is unknown everywhere.
    const allFrameworkSlugs = getIntegrations().map((i) => i.slug);
    const availableIn = findFrameworksWithPage(
      slugPath,
      allFrameworkSlugs,
      getDocsFolder,
    );
    if (availableIn.length > 0) {
      return (
        <NotAvailableForFrameworkPage
          slugPath={slugPath}
          availableIn={availableIn}
          navTree={navTree}
          frameworkName={frameworkName}
          frameworkSlug={scopedFramework}
          slugHrefPrefix={scopedSlugHrefPrefix ?? `/${scopedFramework}`}
          activeFrontendPage={activeFrontendPage}
        />
      );
    }
    notFound();
  }

  // Detect whether this page's default cell (the feature) has any
  // snippets tagged for the current framework. When it doesn't, show
  // a prominent banner pointing the user at a framework that does.
  const missingCell =
    integration &&
    doc.fm.defaultCell &&
    !frameworkHasCellFor(scopedFramework, doc.fm.defaultCell);
  const alternativeFrameworks = doc.fm.defaultCell
    ? findFrameworksWithCell(
        doc.fm.defaultCell,
        getIntegrations().map((i) => i.slug),
        demos,
      )
    : [];

  const banner = missingCell ? (
    <div className="shell-docs-radius-surface shell-docs-warning-surface mb-6 border p-4 shadow-[var(--shadow-control)]">
      <div className="text-sm font-semibold text-[var(--text)] mb-1">
        Not available for {frameworkName} yet
      </div>
      <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
        This feature (<code>{doc.fm.defaultCell}</code>) hasn't been tagged in
        any {frameworkName} cell yet.
        {alternativeFrameworks.length > 0 && (
          <>
            {" "}
            Try{" "}
            {alternativeFrameworks.slice(0, 3).map((altSlug, i) => {
              const alt = getIntegration(altSlug);
              if (!alt) return null;
              const name = alt.name;
              const href = activeFrontendPage
                ? frontendRoutePath(activeFrontendPage, slugPath, altSlug)
                : `/${altSlug}/${slugPath}`;
              return (
                <React.Fragment key={altSlug}>
                  {i > 0 && ", "}
                  <Link
                    href={href}
                    className="text-[var(--accent)] hover:underline"
                  >
                    {name}
                  </Link>
                </React.Fragment>
              );
            })}
            .
          </>
        )}
      </p>
    </div>
  ) : null;

  return (
    <DocsPageView
      slugPath={slugPath}
      contentSlugPath={contentSlugPath}
      slugHrefPrefix={scopedSlugHrefPrefix ?? `/${scopedFramework}`}
      frameworkOverride={scopedFramework}
      navTree={
        activeFrontendPage
          ? getFrontendQuickstartNavTree(activeFrontendPage)
          : navTree
      }
      bannerSlot={banner}
      sidebarBannerSlot={
        activeFrontendPage ? (
          <FrontendSidebarBanner frontend={activeFrontendPage} />
        ) : undefined
      }
    />
  );
}

function FrontendQuickstartDocsPage({
  frontend,
  activeBackendFramework,
  routeSlugPath = "",
  navTree,
}: {
  frontend: FrontendPageId;
  activeBackendFramework?: string | null;
  routeSlugPath?: string;
  navTree?: NavNode[];
}) {
  const contentSlug = getFrontendContentSlug(frontend);
  if (!loadDoc(contentSlug)) notFound();

  return (
    <DocsPageView
      slugPath={routeSlugPath}
      contentSlugPath={contentSlug}
      slugHrefPrefix={frontendRoutePath(frontend, "", activeBackendFramework)}
      frameworkOverride={activeBackendFramework}
      navTree={navTree ?? getFrontendQuickstartNavTree(frontend)}
      sidebarBannerSlot={<FrontendSidebarBanner frontend={frontend} />}
    />
  );
}

function FrontendGuidanceDocsPage({
  frontend,
  activeBackendFramework,
  navTree,
}: {
  frontend: FrontendPageId;
  activeBackendFramework?: string | null;
  navTree?: NavNode[];
}) {
  const contentSlug = getFrontendGuidanceContentSlug(frontend);
  if (!loadDoc(contentSlug)) notFound();

  return (
    <DocsPageView
      slugPath="using-these-docs"
      contentSlugPath={contentSlug}
      slugHrefPrefix={frontendRoutePath(frontend, "", activeBackendFramework)}
      frameworkOverride={activeBackendFramework}
      navTree={navTree ?? getFrontendQuickstartNavTree(frontend)}
      sidebarBannerSlot={<FrontendSidebarBanner frontend={frontend} />}
    />
  );
}

function FrontendSidebarBanner(_props: { frontend: FrontendPageId }) {
  return <SidebarFrameworkSelector />;
}

// ---------------------------------------------------------------------------
// Framework root page: renders the docs shell at the bare `/<framework>`
// URL using one of three content sources, tried in order:
//
//   Tier 1. Data-driven `FrameworkOverview` from `frameworkOverviews`
//           (13 frameworks). Optionally augmented with an after-features
//           MDX escape hatch loaded from
//           `src/content/framework-overviews/<slug>/after-features.mdx`.
//   Tier 2. Free-form `integrations/<folder>/index.mdx`, rendered
//           through the standard MDX pipeline. Used by built-in-agent
//           and deepagents, which don't fit the FrameworkOverview shape.
//   Tier 3. 404 — every registered integration should resolve via Tier
//           1 or Tier 2. A missing record + missing MDX is an authoring
//           error.
//
// The sidebar / framework-selector chrome is identical to the per-doc
// `DocsPageView` rendering so the framework-root URL reads as part of
// the docs surface rather than a separate landing.
// ---------------------------------------------------------------------------

const FRAMEWORK_OVERVIEW_MDX_DIR = path.join(
  process.cwd(),
  "src/content/framework-overviews",
);

async function FrameworkRootPage({
  framework,
  preferIndexMdx = false,
  slugHrefPrefix = `/${framework}`,
  navTreeOverride,
  sidebarBannerSlot,
}: {
  framework: string;
  preferIndexMdx?: boolean;
  slugHrefPrefix?: string;
  navTreeOverride?: NavNode[];
  sidebarBannerSlot?: React.ReactNode;
}) {
  // Some frameworks are docs-only — they have a `frameworkOverviews`
  // entry and an `integrations/<slug>/` content folder, but no demo
  // package in `showcase/integrations/`, so `getIntegration()` returns
  // undefined. Don't bail here — fall back to slug-derived inputs and
  // let the Tier 1/2/3 cascade below decide whether to render or 404.
  const integration = getIntegration(framework);

  // Resolve the URL slug to its docs folder — see comment in
  // FrameworkScopedDocsPage above. Authored frameworks get their own
  // sidebar tree; generated frameworks get the merged root/override IA.
  // `getDocsFolder` already falls back to the slug itself when there's
  // no override, so it's safe for docs-only frameworks.
  const docsFolder = getDocsFolder(framework);
  // Display name preference: integration record → overview data →
  // raw slug. Used as the framework-specific sidebar section header.
  const integrationName =
    integration?.name ??
    frameworkOverviews[framework]?.frameworkName ??
    framework;
  const docsMode = getDocsMode(framework);
  const navTree: NavNode[] =
    navTreeOverride ??
    (docsMode === "authored"
      ? buildFrameworkOnlyNav(docsFolder)
      : buildFrameworkNav(docsFolder, integrationName, framework));

  const indexContentPath = `integrations/${docsFolder}/index`;
  const indexDoc = loadDoc(indexContentPath);

  if (preferIndexMdx && indexDoc) {
    return (
      <DocsPageView
        slugPath=""
        contentSlugPath={indexContentPath}
        slugHrefPrefix={slugHrefPrefix}
        frameworkOverride={framework}
        navTree={navTree}
        sidebarBannerSlot={sidebarBannerSlot}
      />
    );
  }

  // Tier 1: data-driven FrameworkOverview. ONLY for `generated` mode —
  // `authored` frameworks skip straight to Tier 2 so their ported
  // index.mdx (not the auto-generated catalog landing) renders at
  // `/<framework>`.
  const overview = frameworkOverviews[framework];
  if (overview && docsMode === "generated") {
    let afterFeatures: React.ReactNode = undefined;
    if (overview.hasAfterFeaturesMdx) {
      const mdxPath = path.join(
        FRAMEWORK_OVERVIEW_MDX_DIR,
        framework,
        "after-features.mdx",
      );
      if (fs.existsSync(mdxPath)) {
        try {
          const raw = fs.readFileSync(mdxPath, "utf-8");
          afterFeatures = await MDXRemote({
            source: raw,
            components: {
              ...docsComponents,
              // Mirror DocsPageView: wrap MDX-rendered <pre> blocks
              // with figure chrome (copy button + optional file-path
              // caption) so fenced code in after-features.mdx has the
              // same affordances as fenced code on a regular docs
              // page. `rehypeCodeMeta` (below) supplies the
              // `data-title` / `data-language` data-attrs MdxCodeBlock
              // reads.
              pre: MdxCodeBlock,
              // Bind the URL framework slug so any MdxFrameworkOverview
              // usage inside after-features.mdx routes through the
              // rewriter with the URL-active variant — same rationale
              // as DocsPageView's components-map override.
              FrameworkOverview: (props: MdxFrameworkOverviewProps) => (
                <MdxFrameworkOverview
                  {...props}
                  currentFramework={framework ?? props.currentFramework}
                  hrefPrefix={slugHrefPrefix}
                />
              ),
              // Mirror the binding in DocsPageView so any
              // <FrameworkSetup> embedded in after-features.mdx also
              // gets the URL framework slug threaded in.
              FrameworkSetup: (props: {
                concept: string;
                heading?: string | null;
                headingId?: string;
                currentFramework?: string;
              }) => (
                <FrameworkSetup
                  {...props}
                  currentFramework={framework ?? props.currentFramework}
                />
              ),
            },
            options: {
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                // Fumadocs's Shiki-based `rehypeCode`; our
                // `transformerMeta` Shiki transformer surfaces fence
                // `title="..."` and the resolved language as data-attrs
                // on the <pre> so MdxCodeBlock can render Fumadocs's
                // CodeBlock figcaption + copy button.
                rehypePlugins: [
                  [
                    rehypeCode,
                    {
                      fallbackLanguage: "plaintext",
                      transformers: [
                        ...(rehypeCodeDefaultOptions.transformers ?? []),
                        transformerMeta(),
                      ],
                    },
                  ],
                ],
              },
            },
          });
        } catch (err) {
          // Logged + swallowed: FrameworkOverview falls back to the
          // structured `data.cta` block when `afterFeatures` is empty,
          // so a transient read failure doesn't blank the page.
          console.error(
            `[framework-root] failed to read after-features.mdx for ${framework}`,
            err,
          );
        }
      } else {
        console.error(
          `[framework-root] hasAfterFeaturesMdx=true but file is missing: ${mdxPath}`,
        );
      }
    }
    return (
      <FrameworkRootShell
        navTree={navTree}
        slugHrefPrefix={slugHrefPrefix}
        sidebarBannerSlot={sidebarBannerSlot}
      >
        <FrameworkOverview
          data={overview}
          currentFramework={framework}
          hrefPrefix={slugHrefPrefix}
          afterFeatures={afterFeatures}
        />
      </FrameworkRootShell>
    );
  }

  // Tier 2: free-form `integrations/<folder>/index.mdx`. Delegate to
  // `DocsPageView` so the MDX renders through the same component map
  // (Callout, Cards, OpsPlatformCTA, …) used by every other docs page.
  // `slugPath=""` keeps active-link logic pointing at the framework
  // root (the new `"index"`→`""` rewrite in buildFrameworkOverridesNav
  // matches this).
  if (indexDoc) {
    return (
      <DocsPageView
        slugPath=""
        contentSlugPath={indexContentPath}
        slugHrefPrefix={slugHrefPrefix}
        frameworkOverride={framework}
        navTree={navTree}
        sidebarBannerSlot={sidebarBannerSlot}
      />
    );
  }

  // Tier 3: no data record AND no MDX index. Authoring gap.
  notFound();
}

/**
 * Sidebar + content-wrapper chrome shared with `DocsPageView`. Used by
 * Tier 1 (data-driven FrameworkOverview) only; Tier 2 delegates to
 * `DocsPageView` directly.
 */
function FrameworkRootShell({
  navTree,
  slugHrefPrefix,
  sidebarBannerSlot,
  children,
}: {
  navTree: NavNode[];
  slugHrefPrefix: string;
  sidebarBannerSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pageTree = navTreeToPageTree(navTree, slugHrefPrefix);
  return (
    <ShellDocsLayout
      tree={pageTree}
      banner={sidebarBannerSlot ?? <SidebarFrameworkSelector />}
    >
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-0 pb-6">
          {children}
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}

// ---------------------------------------------------------------------------
// "Not available for this framework" fallback. Rendered when the URL's
// slug has no root MDX, no override for the URL's framework, but DOES
// exist for one or more other frameworks (typically a BIA-specific
// page being hit under a different integration's scope). The goal is
// to keep the user in context — sidebar intact, framework switcher
// reachable — while pointing them at the frameworks where the page
// actually exists.
// ---------------------------------------------------------------------------

function NotAvailableForFrameworkPage({
  slugPath,
  availableIn,
  navTree,
  frameworkName,
  frameworkSlug,
  slugHrefPrefix = `/${frameworkSlug}`,
  activeFrontendPage = null,
}: {
  slugPath: string;
  availableIn: string[];
  navTree: NavNode[];
  frameworkName: string;
  frameworkSlug: string;
  slugHrefPrefix?: string;
  activeFrontendPage?: FrontendPageId | null;
}) {
  const title = humanizeSlug(slugPath);
  const sidebarNavTree = activeFrontendPage
    ? getFrontendQuickstartNavTree(activeFrontendPage)
    : navTree;
  const pageTree = navTreeToPageTree(sidebarNavTree, slugHrefPrefix);
  return (
    <ShellDocsLayout
      tree={pageTree}
      banner={
        activeFrontendPage ? (
          <FrontendSidebarBanner frontend={activeFrontendPage} />
        ) : (
          <SidebarFrameworkSelector />
        )
      }
    >
      <DocsPage
        toc={[]}
        tableOfContent={{ enabled: false }}
        tableOfContentPopover={{ enabled: false }}
        breadcrumb={{ enabled: false }}
        footer={{ enabled: false }}
      >
        <div className="docs-inner-content max-w-[900px] mx-auto px-4 md:px-6 pt-2 pb-6 md:pt-3 xl:pt-4">
          <h1 className="text-[2rem] font-bold text-[var(--text)] tracking-tight mb-2 leading-tight">
            {title}
          </h1>
          <p className="text-base text-[var(--text-muted)] mb-6 leading-relaxed">
            This topic isn't available for {frameworkName}.
          </p>
          <div className="shell-docs-radius-surface shell-docs-warning-surface mb-6 border p-5 shadow-[var(--shadow-control)]">
            <div className="text-sm font-semibold text-[var(--text)] mb-2">
              Available in other integrations
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed mb-3">
              <code>{slugPath}</code> is a topic specific to other integrations.
              Pick one to continue reading:
            </p>
            <ul className="space-y-2">
              {availableIn.map((slug) => {
                const alt = getIntegration(slug);
                if (!alt) return null;
                const href = activeFrontendPage
                  ? frontendRoutePath(activeFrontendPage, slugPath, slug)
                  : `/${slug}/${slugPath}`;
                return (
                  <li key={slug}>
                    <Link
                      href={href}
                      className="text-sm text-[var(--accent)] hover:underline"
                    >
                      {alt.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="text-[13px] text-[var(--text-muted)]">
            Or return to{" "}
            <Link
              href={slugHrefPrefix}
              className="text-[var(--accent)] hover:underline"
            >
              the {frameworkName} docs
            </Link>
            .
          </p>
        </div>
      </DocsPage>
    </ShellDocsLayout>
  );
}

function humanizeSlug(slugPath: string): string {
  const last = slugPath.split("/").pop() ?? slugPath;
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
