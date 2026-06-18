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

function asReactDocsProxyNode(node: NavNode): NavNode {
  if (node.type === "group") {
    return {
      ...node,
      variant: "react-docs-proxy",
      children: node.children.map(asReactDocsProxyNode),
    };
  }

  if (node.type === "page") {
    return { ...node, variant: "react-docs-proxy" };
  }

  return { ...node, variant: "react-docs-proxy" };
}

function isGettingStartedSection(node: NavNode): boolean {
  return (
    node.type === "section" &&
    /^(get|getting) started$/i.test(node.title.trim())
  );
}

function isConceptsSection(node: NavNode): boolean {
  return (
    node.type === "section" && node.title.trim().toLowerCase() === "concepts"
  );
}

function sectionSlice(
  nodes: NavNode[],
  isSectionStart: (node: NavNode) => boolean,
): NavNode[] {
  const startIndex = nodes.findIndex(isSectionStart);
  if (startIndex === -1) return [];

  const nextSectionIndex = nodes.findIndex(
    (node, index) => index > startIndex && node.type === "section",
  );

  return nodes.slice(
    startIndex,
    nextSectionIndex === -1 ? nodes.length : nextSectionIndex,
  );
}

function withoutRootSections(
  nodes: NavNode[],
  isRemovedSection: (node: NavNode) => boolean,
): NavNode[] {
  const nextNodes: NavNode[] = [];

  for (let index = 0; index < nodes.length; ) {
    const node = nodes[index];

    if (node.type === "section" && isRemovedSection(node)) {
      index += 1;
      while (index < nodes.length && nodes[index].type !== "section") {
        index += 1;
      }
      continue;
    }

    nextNodes.push(node);
    index += 1;
  }

  return nextNodes;
}

function rootSurfaceNav(): NavNode[] {
  return buildRootSurfaceNav("built-in-agent");
}

function getSharedConceptsNavTree(): NavNode[] {
  return sectionSlice(rootSurfaceNav(), isConceptsSection);
}

function getReactParallelsNavTree(): NavNode[] {
  return withoutRootSections(
    rootSurfaceNav(),
    (node) => isGettingStartedSection(node) || isConceptsSection(node),
  ).map(asReactDocsProxyNode);
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
    ...getSharedConceptsNavTree(),
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
    },
    ...getReactParallelsNavTree(),
  ];
}
