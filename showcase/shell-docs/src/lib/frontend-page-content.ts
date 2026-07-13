import { FRONTEND_OPTIONS, isFrontendEarlyAccess } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export const FRONTEND_GUIDANCE_CONTENT_SLUG = "frontends/using-these-docs";
export const FRONTEND_DOCS_STATUS_CONTENT_SLUG = "frontends/docs-status";

export function getFrontendGuidanceContentSlug(id: FrontendPageId): string {
  return isFrontendEarlyAccess(id)
    ? FRONTEND_GUIDANCE_CONTENT_SLUG
    : FRONTEND_DOCS_STATUS_CONTENT_SLUG;
}

export function getFrontendGuidanceTitle(id: FrontendPageId): string {
  return isFrontendEarlyAccess(id) ? "About early access" : "Docs status";
}

export function getFrontendUsingTheseDocsPath(id: FrontendPageId): string {
  return `/${id}/using-these-docs`;
}

const FRONTEND_REFERENCE_SLUGS = {
  vue: "reference",
  "react-native": "reference/react-native",
  angular: "reference",
  slack: "reference/channels",
  teams: "reference",
} satisfies Record<FrontendPageId, string>;

export function getFrontendReferenceSlug(id: FrontendPageId): string {
  return FRONTEND_REFERENCE_SLUGS[id];
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  const frontendName =
    FRONTEND_OPTIONS.find((option) => option.id === id)?.name ?? id;

  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: "" },
    {
      type: "page",
      title: getFrontendGuidanceTitle(id),
      slug: "using-these-docs",
    },
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
      href: `/${getFrontendReferenceSlug(id)}`,
    },
    {
      type: "section",
      title: frontendName,
      icon: "lucide/RefreshCw",
      variant: "frontend-docs-upcoming",
      quickstartHref: `/${id}`,
      referenceHref: `/${getFrontendReferenceSlug(id)}`,
      frontendDocsStatus: isFrontendEarlyAccess(id)
        ? "early-access"
        : "feature-complete",
    },
  ];
}
