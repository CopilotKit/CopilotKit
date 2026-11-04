import type * as PageTree from "fumadocs-core/page-tree";
import type { SortedResult } from "fumadocs-core/search";
import {
  createSearchAPI,
  type AdvancedIndex,
  type SearchAPI,
} from "fumadocs-core/search/server";
import type { DocsScope } from "@/components/docs-mdx/scope";
import { resolveLivePage } from "@/lib/live-docs";
import {
  LIVE_FRAMEWORKS,
  UNSCOPED_SEGMENTS,
  frontendSegment,
  liveFrontend,
  scopeFromPath,
} from "@/lib/live-scope";
import {
  GROUP_CLOSE,
  GROUP_OPEN,
  GROUP_OPEN_EXPANDED,
  liveSource,
  referenceSource,
} from "@/lib/live-source";
import { getIntegration, ROOT_FRAMEWORK } from "@/components/docs-mdx/data";
import { searchEntries } from "./live-inventory";
import { mapLimit } from "./map-limit";

// Orama search over the live docs (each page once, at an unscoped live URL;
// see `searchEntries()`) and the API reference. Serves the sidebar's search
// dialog (`/api/search`), Ask AI, and the MCP `search` tool.
//
// The index is built on the first query (not at import, which `next build`
// does while collecting routes): each page's structured data comes from its
// compiled MDX (`load()`), a few pages at a time. A failed build is retried
// on the next query.

async function buildIndexes(): Promise<AdvancedIndex[]> {
  const crumbs = new Map([
    ...breadcrumbs(liveSource.getPageTree()),
    ...breadcrumbs(referenceSource.getPageTree(), ["Reference"]),
  ]);

  const live = await mapLimit(searchEntries(), 8, async ({ url, live }) => {
    try {
      const { structuredData } = await live.page.data.load();
      return {
        id: url,
        url,
        title: live.page.data.title,
        description: live.page.data.description,
        breadcrumbs:
          frameworkCrumb(live.scope.framework) ?? crumbs.get(live.page.url),
        structuredData,
      } satisfies AdvancedIndex;
    } catch (error) {
      // One page that fails to compile shouldn't take search down.
      console.error(`[search] failed to index ${url}`, error);
      return null;
    }
  });

  return live.filter((index) => index !== null);
}

/** A framework's own page is labeled with the framework (`Mastra`). */
function frameworkCrumb(framework: string | null): string[] | undefined {
  if (!framework || framework === ROOT_FRAMEWORK) return undefined;
  const name = getIntegration(framework)?.name;
  return name ? [name] : undefined;
}

/**
 * Each page's sidebar trail (folder and section names), keyed by its loader
 * URL, like Fumadocs' own `createFromSource` breadcrumbs.
 */
function breadcrumbs(
  tree: PageTree.Root,
  root: string[] = [],
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const walk = (nodes: PageTree.Node[], parents: string[]) => {
    let current = parents;
    for (const node of nodes) {
      if (node.type === "separator") {
        const name = typeof node.name === "string" ? node.name : "";
        if (name === GROUP_CLOSE) current = parents;
        else if (name) {
          const title = name.replace(
            name.startsWith(GROUP_OPEN_EXPANDED)
              ? GROUP_OPEN_EXPANDED
              : GROUP_OPEN,
            "",
          );
          current = title ? [...parents, title] : parents;
        }
      } else if (node.type === "folder") {
        const path =
          typeof node.name === "string" ? [...current, node.name] : current;
        if (node.index && !out.has(node.index.url))
          out.set(node.index.url, path);
        walk(node.children, path);
      } else if (!out.has(node.url)) {
        out.set(node.url, current);
      }
    }
  };
  walk(tree.children, root);
  return out;
}

let api: SearchAPI | undefined;

async function current<T>(use: (api: SearchAPI) => Promise<T>): Promise<T> {
  // `createSearchAPI` starts indexing as soon as it's called.
  const instance = (api ??= createSearchAPI("advanced", {
    indexes: buildIndexes,
  }));
  try {
    return await use(instance);
  } catch (error) {
    if (api === instance) api = undefined;
    throw error;
  }
}

export const liveSearch: SearchAPI = {
  search: (query, options) => current((s) => s.search(query, options)),
  export: () => current((s) => s.export()),
  GET: (request) => current((s) => s.GET(request)),
  staticGET: () => current((s) => s.staticGET()),
};

// ---------------------------------------------------------------------------
// Results in the reader's scope
// ---------------------------------------------------------------------------

const segments = (url: string) => url.split("/").filter(Boolean);

/**
 * The URL a result opens for a reader on `scope`, as shell-docs' search
 * mapped its index (`search-hrefs.ts`). The index lists each page once,
 * unscoped, under its folder's first framework, or under its own frontend, so
 * on `/vue/mastra/...` both `/frontend-tools` and Vue's `/vue/frontend-tools`
 * open `/vue/mastra/frontend-tools`, and on `/langgraph-typescript/...`
 * LangGraph's own pages open under `langgraph-typescript`. Another
 * framework's or frontend's own page keeps its own; a URL that wouldn't serve
 * a page in the reader's scope stays as indexed.
 */
function scopedUrl(url: string, scope: DocsScope): string {
  const path = segments(url);
  const [first] = path;
  if (!first) return url;
  const fe =
    scope.frontend !== "react" ? `/${frontendSegment(scope.frontend)}` : "";

  // The Slack and Teams guide (`/channels/<slug>`) on the reader's channel.
  if (first === "channels") {
    if (scope.frontend !== "slack" && scope.frontend !== "teams") return url;
    const fw = scope.framework ? `/${scope.framework}` : "";
    const guide = path.slice(1).join("/");
    return firstServed([`${fe}${fw}${guide ? `/${guide}` : ""}`]) ?? url;
  }
  if (UNSCOPED_SEGMENTS.has(first)) return url;

  const own = scopeFromPath(path);
  const ownFrontend = liveFrontend(first) !== undefined;
  if (ownFrontend && own.frontend !== scope.frontend) return url;
  const sameFolder =
    own.framework &&
    scope.framework &&
    LIVE_FRAMEWORKS[own.framework]?.folder ===
      LIVE_FRAMEWORKS[scope.framework]?.folder;
  const framework = sameFolder
    ? scope.framework
    : (own.framework ?? scope.framework);
  const fw = framework && framework !== ROOT_FRAMEWORK ? `/${framework}` : "";
  const page = own.slug ? `/${own.slug}` : "";
  // A frontend's own page stays on that frontend.
  if (ownFrontend) return firstServed([`${fe}${fw}${page}`]) ?? url;
  // A framework's landing stays one: `/vue/mastra` is Vue's own page.
  if (!page) return (fw && firstServed([fw])) || url;
  return firstServed([`${fe}${fw}${page}`, `${fw}${page}`]) ?? url;
}

function firstServed(candidates: string[]): string | undefined {
  return candidates.find(
    (candidate) => candidate && resolveLivePage(segments(candidate)),
  );
}

/**
 * Search results for a reader on the page `scope` (its URL prefix,
 * `/vue/mastra`), each opening in that scope. When two indexed pages land on
 * the same URL (`/frontend-tools` and Mastra's own `/mastra/frontend-tools`
 * for a Mastra reader), only the one that URL serves is kept.
 */
export function inReaderScope(
  results: SortedResult[],
  prefix: string,
): SortedResult[] {
  const { frontend, framework } = scopeFromPath(segments(prefix));
  const scope: DocsScope = { frontend, framework };
  const content = (url: string) => resolveLivePage(segments(url))?.contentPath;

  const targets = new Map<string, string>();
  const keep = new Map<string, string>();
  for (const { url } of results) {
    const source = url.split("#")[0];
    if (targets.has(source)) continue;
    const target = scopedUrl(source, scope);
    targets.set(source, target);
    const kept = keep.get(target);
    // Prefer the source whose page the target URL serves.
    if (
      !kept ||
      (content(source) === content(target) && content(kept) !== content(target))
    ) {
      keep.set(target, source);
    }
  }

  return results.flatMap((result) => {
    const [source, hash] = result.url.split("#");
    const target = targets.get(source)!;
    if (keep.get(target) !== source) return [];
    return [
      { ...result, url: hash === undefined ? target : `${target}#${hash}` },
    ];
  });
}
