import { FRONTEND_OPTIONS } from "./frontend-options";
import type { FrontendId } from "./frontend-options";
import { buildRootSurfaceNav } from "./docs-render";
import type { NavNode } from "./docs-render";
import {
  isFrontendFirstClassDoc,
  isFrontendOwnedDoc,
} from "./frontend-doc-policy";

export type FrontendPageId = Exclude<FrontendId, "react">;

export const FRONTEND_PAGE_IDS = FRONTEND_OPTIONS.filter(
  (option) => option.id !== "react",
).map((option) => option.id) as FrontendPageId[];

export function getFrontendContentSlug(id: FrontendPageId): string {
  return `frontends/${id}`;
}

export const FRONTEND_GUIDANCE_CONTENT_SLUG = "frontends/using-these-docs";

export function getFrontendUsingTheseDocsPath(id: FrontendPageId): string {
  return `/frontends/${id}/using-these-docs`;
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
    return { ...node, href: `/${node.slug}`, variant: "react-docs-proxy" };
  }

  return { ...node, variant: "react-docs-proxy" };
}

function isGettingStartedSection(node: NavNode): boolean {
  return (
    node.type === "section" &&
    /^(get|getting) started$/i.test(node.title.trim())
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

function filterFrontendOwnedNode(
  node: NavNode,
  id: FrontendPageId,
): NavNode | null {
  if (node.type === "page") {
    return isFrontendFirstClassDoc(id, node.slug) ? node : null;
  }

  if (node.type === "group") {
    const children = node.children
      .map((child) => filterFrontendOwnedNode(child, id))
      .filter((child): child is NavNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  }

  return node;
}

function getFrontendOwnedNavTree(id: FrontendPageId): NavNode[] {
  const nextNodes: NavNode[] = [];
  let pendingSection: NavNode | null = null;

  for (const node of rootSurfaceNav()) {
    if (node.type === "section") {
      pendingSection = node;
      continue;
    }

    const filteredNode = filterFrontendOwnedNode(node, id);
    if (!filteredNode) continue;

    if (pendingSection) {
      nextNodes.push(pendingSection);
      pendingSection = null;
    }
    nextNodes.push(filteredNode);
  }

  return nextNodes;
}

function dropEmptySections(nodes: NavNode[]): NavNode[] {
  return nodes.filter((node, index) => {
    if (node.type !== "section") return true;

    const nextNode = nodes[index + 1];
    return nextNode !== undefined && nextNode.type !== "section";
  });
}

function filterReactParallelsNode(node: NavNode): NavNode | null {
  if (node.type === "page") {
    return isFrontendOwnedDoc(node.slug) ? null : asReactDocsProxyNode(node);
  }

  if (node.type === "group") {
    const children = node.children
      .map(filterReactParallelsNode)
      .filter((child): child is NavNode => child !== null);
    return children.length > 0
      ? asReactDocsProxyNode({ ...node, children })
      : null;
  }

  return asReactDocsProxyNode(node);
}

function getReactParallelsNavTree(): NavNode[] {
  const filtered = withoutRootSections(
    rootSurfaceNav(),
    isGettingStartedSection,
  )
    .map(filterReactParallelsNode)
    .filter((node): node is NavNode => node !== null);

  return dropEmptySections(filtered);
}

export function getFrontendQuickstartNavTree(id: FrontendPageId): NavNode[] {
  return [
    { type: "section", title: "Getting Started", icon: "lucide/Rocket" },
    { type: "page", title: "Quickstart", slug: "" },
    {
      type: "page",
      title: "Using these docs 🏗️",
      slug: "using-these-docs",
      icon: "lucide/Wrench",
    },
    ...getFrontendOwnedNavTree(id),
    { type: "section", title: "More to explore", icon: "lucide/BookOpen" },
    {
      type: "page",
      title: "Reference docs",
      slug: getFrontendReferenceSlug(id),
      href: `/${getFrontendReferenceSlug(id)}`,
    },
    ...getReactParallelsNavTree(),
  ];
}
