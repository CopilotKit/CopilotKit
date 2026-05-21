import { NextResponse } from "next/server";
import path from "path";
import {
  AG_UI_CONTENT_DIR,
  REFERENCE_CONTENT_DIR,
} from "@/lib/sitemap-helpers";
import { loadDoc } from "@/lib/docs-render";
import { getDocsFolder, getDocsMode, getIntegrations } from "@/lib/registry";
import type { LlmPage } from "@/lib/llm-text";
import { renderPageToLlmText } from "@/lib/llm-text";
import fs from "fs";

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
}

function resolvePage(slug: string[]): ResolvedPage | null {
  const first = slug[0]!;
  const rest = slug.slice(1).join("/");
  const url = slug.join("/");

  // /reference/<slug>.md → src/content/reference/<slug>.mdx
  if (first === "reference") {
    const refSlug = rest || "index";
    const filePath = findExistingMdx(REFERENCE_CONTENT_DIR, refSlug);
    if (!filePath) return null;
    return {
      page: {
        url,
        title: refSlug,
        filePath,
        loadSlug: `__reference__/${refSlug}`,
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
    const docsFolder = getDocsFolder(first);
    const docsMode = getDocsMode(first);
    const tail = rest || "index";
    const rootSlugPath = tail;
    const frameworkSlugPath = `integrations/${docsFolder}/${tail}`;

    // `authored` frameworks own their entire IA — try the per-framework
    // tree first. `generated` is the inverse — root wins, framework
    // tree is the override.
    const candidateOrder =
      docsMode === "authored"
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
          framework: first,
        },
        framework: first,
      };
    }
    return null;
  }

  // Bare unscoped doc.
  const doc = loadDoc(url);
  if (!doc) return null;
  return {
    page: {
      url,
      title: doc.fm.title,
      description: doc.fm.description,
      filePath: doc.filePath,
      loadSlug: url,
    },
  };
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
