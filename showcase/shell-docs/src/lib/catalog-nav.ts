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
 * page per component (`.../standard-catalog/box`). shell-docs' meta.json lists
 * only the catalog page, inside "Components and surfaces"; the folder takes
 * its place right after that folder, in every sidebar that lists it.
 */
export function withCatalogNav(nav: LiveNav): LiveNav {
  const each = (trees: Record<string, PageTree.Node[]>) =>
    Object.fromEntries(
      Object.entries(trees).map(([key, nodes]) => [key, moveCatalog(nodes)]),
    );
  return {
    ...nav,
    root: moveCatalog(nav.root),
    folders: each(nav.folders),
    overrides: each(nav.overrides),
  };
}

const isCatalogPage = (n: PageTree.Node): n is PageTree.Item =>
  n.type === "page" && n.url.endsWith(CATALOG_REFERENCE_PATH);

function moveCatalog(nodes: PageTree.Node[]): PageTree.Node[] {
  return nodes.flatMap((n): PageTree.Node[] => {
    if (n.type !== "folder") return [n];
    const page = n.children.find(isCatalogPage);
    const folder = {
      ...n,
      children: moveCatalog(n.children.filter((c) => c !== page)),
    };
    return page ? [folder, catalogFolder(page)] : [folder];
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
