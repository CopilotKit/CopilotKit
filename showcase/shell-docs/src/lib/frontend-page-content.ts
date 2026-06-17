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

export const FRONTEND_GUIDANCE_CONTENT_SLUG = "frontends/using-these-docs";

export function getFrontendUsingTheseDocsSlug(id: FrontendPageId): string {
  return `frontends/${id}/using-these-docs`;
}

const FRONTEND_REFERENCE_SLUGS = {
  vue: "reference",
  "react-native": "reference/react-native",
  slack: "reference/bot",
  teams: "reference",
} satisfies Record<FrontendPageId, string>;

export function getFrontendReferenceSlug(id: FrontendPageId): string {
  return FRONTEND_REFERENCE_SLUGS[id];
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
      title: "Using these docs 🏗️",
      slug: getFrontendUsingTheseDocsSlug(id),
      icon: "lucide/Wrench",
    },
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
    },
    {
      type: "page",
      title: "React docs for deeper examples",
      slug: "",
    },
    {
      type: "section",
      title: "React docs",
      icon: "lucide/RefreshCw",
      variant: "shadow-divider",
    },
    {
      type: "page",
      title:
        "More dedicated guides are on the way for this frontend. Use the React docs below for the same CopilotKit patterns.",
      slug: getFrontendUsingTheseDocsSlug(id),
      variant: "shadow-note",
    },
    ...getReactParallelsNavTree(),
  ];
}
