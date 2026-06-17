import { FRONTEND_OPTIONS } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: getFrontendContentSlug(id) },
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "React docs for deeper examples",
      slug: "",
    },
  ];
}
