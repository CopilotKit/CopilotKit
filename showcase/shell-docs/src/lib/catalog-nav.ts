import type * as PageTree from "fumadocs-core/page-tree";
import {
  CATALOG_GROUPS,
  CATALOG_REFERENCE_PATH,
  catalogComponentSlug,
} from "@/components/standard-catalog/catalog-reference";
import type { LiveNav } from "./live-nav";

/**
 * Gives the standard catalog a sidebar folder of its own under Generative
 * UI's Declarative topic: the catalog page, then a folder per group with a
 * page per component (`.../standard-catalog/box`). The meta.json lists only
 * the catalog page; the folder takes its place, in every sidebar that lists
 * it.
 */
export function withCatalogNav(nav: LiveNav): LiveNav {
  return {
    ...nav,
    app: moveCatalog(nav.app),
    frameworks: Object.fromEntries(
      Object.entries(nav.frameworks).map(([folder, own]) => [
        folder,
        { ...own, nodes: moveCatalog(own.nodes) },
      ]),
    ),
  };
}

const isCatalogPage = (n: PageTree.Node): n is PageTree.Item =>
  n.type === "page" && n.url.endsWith(CATALOG_REFERENCE_PATH);

function moveCatalog(nodes: PageTree.Node[]): PageTree.Node[] {
  return nodes.map((n): PageTree.Node => {
    if (isCatalogPage(n)) return catalogFolder(n);
    if (n.type !== "folder") return n;
    return { ...n, children: moveCatalog(n.children) };
  });
}

function catalogFolder(page: PageTree.Item): PageTree.Folder {
  return {
    type: "folder",
    name: page.name,
    index: page,
    children: CATALOG_GROUPS.map(({ title, components }) => ({
      type: "folder",
      name: title,
      children: components.map((name) => ({
        type: "page",
        name,
        url: `${page.url}/${catalogComponentSlug(name)}`,
      })),
    })),
  };
}
