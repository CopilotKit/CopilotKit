import { FRONTEND_OPTIONS } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import { buildRootSurfaceNav } from "./docs-render";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export const FRONTEND_IN_PROGRESS_CONTENT_SLUG = "frontends/how-to-use";

export function getFrontendDocsInProgressSlug(id: FrontendPageId): string {
  return `frontends/${id}/docs-in-progress`;
}

function asShadowNode(node: NavNode): NavNode {
  if (node.type === "group") {
    return {
      ...node,
      variant: "shadow",
      children: node.children.map(asShadowNode),
    };
  }

  return { ...node, variant: "shadow" };
}

function getReactParallelsNavTree(): NavNode[] {
  return buildRootSurfaceNav("built-in-agent").map(asShadowNode);
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: getFrontendContentSlug(id) },
    {
      type: "page",
      title: "Docs in progress",
      slug: getFrontendDocsInProgressSlug(id),
      icon: "lucide/Wrench",
    },
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "Reference docs",
      slug: "reference",
    },
    {
      type: "page",
      title: "React docs for deeper examples",
      slug: "",
    },
    {
      type: "section",
      title: "React parallels",
      icon: "lucide/RefreshCw",
      variant: "shadow-divider",
    },
    ...getReactParallelsNavTree(),
  ];
}
