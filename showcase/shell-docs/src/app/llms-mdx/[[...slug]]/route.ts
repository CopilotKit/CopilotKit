import { NextResponse } from "next/server";
import path from "path";
import { AG_UI_CONTENT_DIR } from "@/lib/sitemap-helpers";
import { loadDoc } from "@/lib/docs-render";
import { resolveFrontendDocPage } from "@/lib/frontend-doc-policy";
import { resolveAngularDoc } from "@/lib/angular-doc-navigation";
import {
  getFrontendContentSlug,
  getFrontendGuidanceContentSlug,
} from "@/lib/frontend-page-content";
import { isFrontendId, parseFrontendRoutePath } from "@/lib/frontend-options";
import type { FrontendId } from "@/lib/frontend-options";
import {
  getDocsFolder,
  getDocsMode,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "@/lib/registry";
import type { LlmPage } from "@/lib/llm-text";
import { renderPageToLlmText } from "@/lib/llm-text";
import { resolveReferencePage } from "@/lib/reference-items";
import fs from "fs";
import matter from "gray-matter";

// Per-page raw-Markdown endpoint. The `next.config.ts` rewrites map
// `<path>.md` and `<path>.mdx` requests onto this route so external
// crawlers and the in-page LLMCopyButton can fetch a clean, LLM-friendly
// version of each docs page.
//
// What we serve (different from the previous version, which returned
// the unrendered MDX source verbatim):
//
//   - `<Snippet ... />` tags are resolved to fenced markdown code blocks
//     using `demo-content.json`, so the LLM sees real code, not a JSX
//     tag it can't interpret.
//   - `<InlineDemo />` tags become short HTML comments (no body content
//     — they're live iframes on the site).
//   - Shared `<Component />` snippets (`<AGUI />`, `<FrontendTools />`,
//     etc.) are inlined from the shared snippets dir, same as the live
//     page renderer.
//   - Frontmatter is stripped and replaced with an H1 + description
//     blockquote so the title survives.
//
// URL resolution mirrors what `app/[framework]/[[...slug]]/page.tsx` does:
//   - Frontend-scoped URLs reuse the same `/<frontend>` content
//     resolution as the live frontend pages.
//   - When the first segment is a known integration slug, we try
//     `integrations/<docsFolder>/<rest>.mdx` first (or root depending on
//     docs_mode), so framework-scoped URLs resolve the correct MDX.
//   - Otherwise we walk the bare slug, then fall back to `/reference/...`
//     and `/ag-ui/...` content roots.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
): Promise<NextResponse> {
  const { slug = [] } = await params;
  if (slug.length === 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const resolved = resolvePage(slug);
  if (!resolved) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = renderPageToLlmText(resolved.page, {
    framework: resolved.framework,
    ...(resolved.frontend ? { frontend: resolved.frontend } : {}),
  });
  if (!body) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}

interface ResolvedPage {
  page: LlmPage;
  framework?: string;
  frontend?: FrontendPageId;
}

type FrontendPageId = Exclude<FrontendId, "react">;

function isFrontendGuidanceSlug(slugPath: string): boolean {
  return slugPath === "using-these-docs";
}

function isFrontendRootSlug(slugPath: string): boolean {
  return !slugPath || slugPath === "quickstart";
}

function resolvePage(slug: string[]): ResolvedPage | null {
  const first = slug[0]!;
  const rest = slug.slice(1).join("/");
  const url = slug.join("/");

  // /<frontend>[/<slug>].md → the same MDX rendered by the
  // frontend-scoped docs pages.
  if (isFrontendId(first)) {
    if (first === "react") return null;

    const frontend = first as FrontendPageId;
    const frontendRoute = parseFrontendRoutePath(
      `/${slug.join("/")}`,
      getIntegrations().map((integration) => integration.slug),
    );
    const frontendRest = frontendRoute?.slugPath ?? rest;
    const activeBackendFramework =
      frontendRoute?.backend === ROOT_FRAMEWORK
        ? undefined
        : (frontendRoute?.backend ?? undefined);
    if (isFrontendGuidanceSlug(frontendRest)) {
      const contentSlug = getFrontendGuidanceContentSlug(frontend);
      const doc = loadDoc(contentSlug);
      if (!doc) return null;

      return {
        page: {
          url,
          title: doc.fm.title,
          description: doc.fm.description,
          filePath: doc.filePath,
          loadSlug: contentSlug,
          framework: activeBackendFramework,
        },
        framework: activeBackendFramework,
        frontend,
      };
    }

    if (isFrontendRootSlug(frontendRest)) {
      const contentSlug = getFrontendContentSlug(frontend);
      const doc = loadDoc(contentSlug);
      if (!doc) return null;

      return {
        page: {
          url,
          title: doc.fm.title,
          description: doc.fm.description,
          filePath: doc.filePath,
          loadSlug: contentSlug,
          framework: activeBackendFramework,
        },
        framework: activeBackendFramework,
        frontend,
      };
    }

    if (frontend === "angular") {
      const resolution = resolveAngularDoc(
        activeBackendFramework ?? null,
        frontendRest,
      );
      if (!resolution) return null;
      const doc = loadDoc(resolution.contentSlugPath);
      if (!doc) return null;

      return {
        page: {
          url,
          title: doc.fm.title,
          description: doc.fm.description,
          filePath: doc.filePath,
          loadSlug: resolution.contentSlugPath,
          framework: resolution.framework,
        },
        framework: resolution.framework,
        frontend,
      };
    }

    if (activeBackendFramework) {
      const resolved = resolveFrameworkScopedPage(
        activeBackendFramework,
        frontendRest || "index",
        url,
      );
      return resolved ? { ...resolved, frontend } : null;
    }

    const contentSlug = (() => {
      const resolution = resolveFrontendDocPage(frontend, frontendRest);
      return resolution.status === "found" ? resolution.contentSlugPath : null;
    })();

    if (!contentSlug) return null;
    const doc = loadDoc(contentSlug);
    if (!doc) return null;

    return {
      page: {
        url,
        title: doc.fm.title,
        description: doc.fm.description,
        filePath: doc.filePath,
        loadSlug: contentSlug,
        framework: activeBackendFramework,
      },
      framework: activeBackendFramework,
      frontend,
    };
  }

  // /reference/<slug>.md → src/content/reference/<slug>.mdx
  if (first === "reference") {
    const referenceSlug = rest ? rest.split("/") : [];
    const resolved = resolveReferencePage(referenceSlug);
    if (!resolved) return null;
    const { data } = matter(resolved.raw);
    return {
      page: {
        url,
        title:
          typeof data.title === "string"
            ? data.title
            : resolved.pageSlug || "Reference",
        description:
          typeof data.description === "string" ? data.description : undefined,
        filePath: resolved.filePath,
        loadSlug: `__reference__/${resolved.contentSlug}`,
      },
    };
  }

  // /ag-ui/<slug>.md → src/content/ag-ui/<slug>.mdx
  if (first === "ag-ui") {
    const agSlug = rest || "index";
    const filePath = findExistingMdx(AG_UI_CONTENT_DIR, agSlug);
    if (!filePath) return null;
    return {
      page: {
        url,
        title: agSlug,
        filePath,
        loadSlug: `__ag-ui__/${agSlug}`,
      },
    };
  }

  // Framework-scoped URL: first segment is an integration slug.
  const frameworkSlugs = new Set(getIntegrations().map((i) => i.slug));
  if (frameworkSlugs.has(first)) {
    return resolveFrameworkScopedPage(first, rest || "index", url);
  }

  // Bare unscoped doc. The root surface serves ROOT_FRAMEWORK's
  // authored page when one exists (mirrors UnscopedDocsPage), so the
  // `.md` variant must resolve the same MDX the page renders.
  const rootOverride = `integrations/${getDocsFolder(ROOT_FRAMEWORK)}/${url}`;
  const candidates =
    getDocsMode(ROOT_FRAMEWORK) === "authored" ? [rootOverride, url] : [url];
  for (const candidate of candidates) {
    const doc = loadDoc(candidate);
    if (!doc) continue;
    const isOverride = candidate !== url;
    return {
      page: {
        url,
        title: doc.fm.title,
        description: doc.fm.description,
        filePath: doc.filePath,
        loadSlug: candidate,
        framework: isOverride ? ROOT_FRAMEWORK : undefined,
      },
      framework: isOverride ? ROOT_FRAMEWORK : undefined,
    };
  }
  return null;
}

function resolveFrameworkScopedPage(
  framework: string,
  tail: string,
  url: string,
): ResolvedPage | null {
  const docsFolder = getDocsFolder(framework);
  const docsMode = getDocsMode(framework);
  const rootSlugPath = tail;
  const frameworkSlugPath = `integrations/${docsFolder}/${tail}`;

  // `authored` frameworks own their entire IA — try the per-framework
  // tree first. `generated` is the inverse — root wins, framework
  // tree is the override, except quickstart where the root file is
  // only a routing shim and the page route prefers framework content.
  const candidateOrder =
    docsMode === "authored" || tail === "quickstart"
      ? [frameworkSlugPath, rootSlugPath]
      : [rootSlugPath, frameworkSlugPath];

  for (const candidate of candidateOrder) {
    const doc = loadDoc(candidate);
    if (!doc) continue;
    return {
      page: {
        url,
        title: doc.fm.title,
        description: doc.fm.description,
        filePath: doc.filePath,
        loadSlug: candidate,
        framework,
      },
      framework,
    };
  }
  return null;
}

/**
 * Resolve `<root>/<slug>.mdx` or `<root>/<slug>/index.mdx` if present.
 * Returns null when neither exists. Constrained to `root` via
 * `path.resolve()` + prefix check to keep slug input from escaping the
 * content dir.
 */
function findExistingMdx(root: string, slug: string): string | null {
  const candidates = [
    path.join(root, `${slug}.mdx`),
    path.join(root, slug, "index.mdx"),
  ];
  const resolvedRoot = path.resolve(root);
  for (const cand of candidates) {
    const resolved = path.resolve(cand);
    if (!resolved.startsWith(resolvedRoot + path.sep)) {
      console.warn(
        "[llms-mdx] rejecting candidate outside content root",
        cand,
        "root:",
        root,
      );
      continue;
    }
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}
