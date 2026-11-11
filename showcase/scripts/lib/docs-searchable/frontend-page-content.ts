import { FRONTEND_OPTIONS, isChannelFrontend } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import { CHANNEL_GUIDE_ROUTES } from "./channel-guide-routes";
import type { ChannelGuideSection } from "./channel-guide-routes";
import { buildFrameworkNav, loadDoc, SHARED_GROUP } from "./docs-render";
import { getDocsFolder, ROOT_FRAMEWORK } from "./registry";
import type { NavNode } from "./docs-render";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

/** A frontend's orientation page (`/vue/using-these-docs`). */
export function getFrontendGuidanceContentSlug(id: FrontendPageId): string {
  return `frontends/${id}/using-these-docs`;
}

export function getFrontendGuidanceTitle(_id: FrontendPageId): string {
  return "Using these docs";
}

export function getFrontendUsingTheseDocsPath(id: FrontendPageId): string {
  return `/${id}/using-these-docs`;
}

/**
 * A frontend's page for a topic has the topic's own slug (Angular's frontend
 * tools page is `/angular/frontend-tools`), so the canonical slug is the
 * slug, without a route group.
 */
export function getFrontendCanonicalSlug(
  _id: FrontendPageId,
  slugPath: string,
): string {
  return slugPath.startsWith("(other)/")
    ? slugPath.slice("(other)/".length)
    : slugPath;
}

const FRONTEND_REFERENCE_SLUGS = {
  // A React SPA uses the root React reference unchanged.
  "react-spa": "reference",
  vue: "reference/vue",
  "react-native": "reference/react-native",
  angular: "reference/angular",
  slack: "reference/channels",
  teams: "reference/channels",
} satisfies Record<FrontendPageId, string>;

export function getFrontendReferenceSlug(id: FrontendPageId): string {
  return FRONTEND_REFERENCE_SLUGS[id];
}

function getChannelGuidePages(
  section: ChannelGuideSection,
  excludeSlugs: readonly string[] = [],
): NavNode[] {
  return CHANNEL_GUIDE_ROUTES.filter(
    (route) => route.section === section && !excludeSlugs.includes(route.slug),
  ).map((route) => ({
    type: "page",
    title: route.navTitle,
    slug: route.slug,
  }));
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  if (isChannelFrontend(id)) {
    return [
      { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
      { type: "page", title: "Overview", slug: "" },
      ...getChannelGuidePages("getting-started", ["overview"]),
      {
        type: "page",
        title: "Connect and run your agent",
        slug: "connect",
      },
      { type: "section", title: "Build", icon: "lucide/Wand2" },
      ...getChannelGuidePages("build"),
      { type: "section", title: "Production", icon: "lucide/ServerCog" },
      ...getChannelGuidePages("production"),
      {
        type: "page",
        title: "API reference",
        slug: "reference/channels",
        href: "/reference/channels",
      },
    ];
  }
  return buildAppFrontendNavTree(id === "react-spa" ? "vue" : id);
}

/** First segments that are folders of their own, never a frontend's page. */
const NON_PAGE_ROOTS = new Set(["frontends", "channels", "integrations"]);

/**
 * Whether `frontend` has a page at `slugPath`, by where the page lives (the
 * docs app's rule, shell-docs/src/lib/live-pages.ts): the frontend's own
 * folder (`frontends/vue`; Slack and Teams also share `channels`), the
 * frontend-neutral pages in `docs/(shared)`, and on React the pages at the
 * content root as well.
 */
export function frontendHasPage(id: FrontendId, slugPath: string): boolean {
  const slug = slugPath.split("/").filter(Boolean).join("/");
  if (NON_PAGE_ROOTS.has(slug.split("/")[0])) return false;
  if (id === "react" || id === "react-spa") {
    // A root page or, through its route group, a shared one.
    return slug !== "" && loadDoc(slug) !== null;
  }
  const folders = isChannelFrontend(id)
    ? [`frontends/${id}`, "channels"]
    : [`frontends/${id}`];
  if (folders.some((folder) => loadDoc(slug ? `${folder}/${slug}` : folder))) {
    return true;
  }
  return slug !== "" && loadDoc(`${SHARED_GROUP}/${slug}`) !== null;
}

function filterFrontendNavNodes(id: FrontendId, nodes: NavNode[]): NavNode[] {
  const filtered: NavNode[] = [];
  let sectionIndex: number | null = null;
  let sectionHasPages = false;

  for (const node of nodes) {
    if (node.type === "section") {
      if (sectionIndex !== null && !sectionHasPages) {
        filtered.splice(sectionIndex, 1);
      }
      filtered.push(node);
      sectionIndex = filtered.length - 1;
      sectionHasPages = false;
      continue;
    }

    if (node.type === "group") {
      const children = filterFrontendNavNodes(id, node.children);
      if (children.length === 0) continue;
      filtered.push({ ...node, children });
      sectionHasPages = true;
      continue;
    }

    if (node.slug === "" || !frontendHasPage(id, node.slug)) continue;
    filtered.push(node);
    sectionHasPages = true;
  }

  if (sectionIndex !== null && !sectionHasPages) {
    filtered.splice(sectionIndex, 1);
  }

  return filtered;
}

/**
 * An app frontend's sidebar (Vue, Angular, React Native): the built-in
 * agent's (`buildFrameworkNav`), keeping only the rows whose page the
 * frontend has (`frontendHasPage`), after its own quickstart. The docs app
 * draws the same rows (shell-docs/src/proto/live-tree.tsx).
 */
export function buildAppFrontendNavTree(id: FrontendPageId): NavNode[] {
  return [
    { type: "page", title: "Quickstart", slug: "" },
    ...filterFrontendNavNodes(
      id,
      buildFrameworkNav(getDocsFolder(ROOT_FRAMEWORK)),
    ),
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
      href: `/${getFrontendReferenceSlug(id)}`,
    },
  ];
}
