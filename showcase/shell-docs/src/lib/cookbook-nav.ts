import path from "path";
import { CONTENT_DIR, buildNavTree } from "@/lib/docs-render";
import type { NavNode } from "@/lib/docs-render";

export function buildCookbookNavTree(): NavNode[] {
  const pages = buildNavTree(path.join(CONTENT_DIR, "cookbook"), "cookbook");

  return pages
    .filter((node) => node.type === "page")
    .map((node) =>
      node.slug === "cookbook/index" ? { ...node, href: "/cookbook" } : node,
    );
}
