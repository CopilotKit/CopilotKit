import type * as PageTree from "fumadocs-core/page-tree";
import {
  createSearchAPI,
  type AdvancedIndex,
  type SearchAPI,
} from "fumadocs-core/search/server";
import {
  GROUP_CLOSE,
  GROUP_OPEN,
  GROUP_OPEN_EXPANDED,
  liveSource,
  referenceSource,
} from "@/lib/live-source";
import { source } from "@/lib/source";
import { getIntegration, ROOT_FRAMEWORK } from "@/components/docs-mdx/data";
import { searchEntries } from "./live-inventory";
import { mapLimit } from "./map-limit";

// Orama search over the live docs (each page once, at an unscoped live URL;
// see `searchEntries()`), the API reference, and the /docs pages. Serves the
// sidebar's search dialog (`/api/search`) and the MCP `search` tool.
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
        breadcrumbs: frameworkCrumb(live.scope.framework) ?? crumbs.get(live.page.url),
        structuredData,
      } satisfies AdvancedIndex;
    } catch (error) {
      // One page that fails to compile shouldn't take search down.
      console.error(`[search] failed to index ${url}`, error);
      return null;
    }
  });

  const docs = source.getPages().map(
    (page): AdvancedIndex => ({
      id: page.url,
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      structuredData: page.data.structuredData,
    }),
  );

  return [...live.filter((index) => index !== null), ...docs];
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
            name.startsWith(GROUP_OPEN_EXPANDED) ? GROUP_OPEN_EXPANDED : GROUP_OPEN,
            "",
          );
          current = title ? [...parents, title] : parents;
        }
      } else if (node.type === "folder") {
        const path =
          typeof node.name === "string" ? [...current, node.name] : current;
        if (node.index && !out.has(node.index.url)) out.set(node.index.url, path);
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
