// Bridge from shell-docs's hand-rolled NavNode tree (built by
// `buildNavTree` walking meta.json files) into Fumadocs's `PageTree.Root`
// shape so `<DocsLayout tree={...}>` can render the same IA with its own
// sidebar UI.
//
// shell-docs's NavNode variants:
//   - { type: "page"; title; slug }
//   - { type: "section"; title }
//   - { type: "group"; title; slug; children }
//
// Fumadocs's PageTree.Node variants:
//   - Item { type: 'page'; name; url }
//   - Separator { type: 'separator'; name }
//   - Folder { type: 'folder'; name; children; defaultOpen?; index? }
//
// We pre-bake the URL using `slugHrefPrefix` (the value DocsPageView
// already uses for its own hrefs): a framework-scoped render passes
// `/<framework>` and the sidebar renders `/<framework>/<slug>` links
// statically, while the root surface (where the Built-in Agent docs are
// served) passes "" and the sidebar links resolve at `/<slug>`.

import React from "react";
import type * as PageTree from "fumadocs-core/page-tree";
import type { NavNode } from "@/lib/docs-render";
import { resolveSidebarIcon } from "@/lib/sidebar-icon";

const frontendUpcomingSkeletonCards = [
  ["long", "medium", "short"],
  ["medium", "long"],
  ["short", "long", "medium"],
  ["long", "short"],
  ["medium", "short"],
  ["short", "medium", "long"],
  ["long", "medium"],
  ["medium", "short"],
] as const;

function buildUrl(prefix: string, slug: string): string {
  // `prefix` is one of "/docs", "/<framework>", or "" (root). Normalize
  // trailing/leading slashes so `/${prefix}/${slug}` never doubles up.
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const right = slug.startsWith("/") ? slug.slice(1) : slug;
  if (!right) return left || "/";
  return left ? `${left}/${right}` : `/${right}`;
}

function renderNavName(
  title: string,
  variant: NavNode["variant"],
  icon?: React.ReactNode,
  links?: {
    quickstartHref?: string;
    referenceHref?: string;
    frontendDocsStatus?: "feature-complete" | "early-access";
  },
): React.ReactNode {
  const isReactDocsProxy = variant === "react-docs-proxy";
  if (variant === "frontend-docs-upcoming") {
    const frontendDocsStatus = links?.frontendDocsStatus ?? "early-access";
    const ariaLabel =
      frontendDocsStatus === "feature-complete"
        ? `${title} guides are coming soon. ${title} is feature complete, but the docs are still catching up. The quickstart and reference guides are ready with more guides on the way.`
        : `${title} guides are coming soon. ${title} is currently in early access. The quickstart and reference guides are ready; more are on the way after early access.`;

    return React.createElement(
      "span",
      {
        className: "shell-docs-frontend-docs-upcoming",
        role: "note",
        "aria-label": ariaLabel,
      },
      React.createElement(
        "span",
        { className: "shell-docs-frontend-docs-upcoming-header" },
        icon,
        React.createElement(
          "span",
          { className: "shell-docs-frontend-docs-upcoming-title" },
          "Guides coming soon...",
        ),
      ),
      React.createElement(
        "span",
        { className: "shell-docs-frontend-docs-upcoming-copy" },
        frontendDocsStatus === "feature-complete"
          ? `${title} is feature complete, but the docs are still catching up. The `
          : `${title} is currently in early access. The `,
        React.createElement(
          "a",
          {
            className: "shell-docs-frontend-docs-upcoming-link",
            href: links?.quickstartHref ?? "#",
          },
          "quickstart",
        ),
        " and ",
        React.createElement(
          "a",
          {
            className: "shell-docs-frontend-docs-upcoming-link",
            href: links?.referenceHref ?? "#",
          },
          "reference",
        ),
        frontendDocsStatus === "feature-complete"
          ? " guides are ready with more guides on the way."
          : " guides are ready; more are on the way after early access.",
      ),
      React.createElement(
        "span",
        {
          className: "shell-docs-frontend-docs-upcoming-stack",
          "aria-hidden": "true",
        },
        frontendUpcomingSkeletonCards.map((lines, cardIndex) =>
          React.createElement(
            "span",
            {
              key: `card-${cardIndex}`,
              className: "shell-docs-frontend-docs-upcoming-sheet",
            },
            lines.map((line, lineIndex) =>
              React.createElement("span", {
                key: `line-${lineIndex}`,
                className: `shell-docs-frontend-docs-upcoming-sheet-line shell-docs-frontend-docs-upcoming-sheet-line-${line}`,
              }),
            ),
          ),
        ),
      ),
    );
  }

  const className =
    variant === "react-docs-proxy" ? "shell-docs-react-docs-proxy" : undefined;

  if (!className && !icon) return title;

  const label = React.createElement(
    "span",
    {
      className,
      key: "label",
      ...(isReactDocsProxy
        ? { "data-shell-docs-react-docs-proxy": "true" }
        : {}),
    },
    title,
  );

  return icon ? React.createElement(React.Fragment, null, icon, label) : label;
}

// Convert a single shell-docs NavNode into ZERO OR MORE PageTree.Nodes.
// Most nodes map 1:1, but a `group` with no title (the dedup-with-
// section-header case) gets FLATTENED into its children — otherwise
// Fumadocs renders an empty folder-trigger button (an orphan chevron
// above its child items), which the user reports as a "weird spot" in
// the sidebar. The flat behavior matches what the source meta.json
// actually intends — the group exists only to scope the children, not
// to be visible chrome.
export function navNodeToPageTreeNodes(
  node: NavNode,
  slugHrefPrefix: string,
): PageTree.Node[] {
  if (node.type === "section") {
    // Section icons come from the NavNode's `icon` field (set either
    // by parseMetaPages from an explicit meta.json icon, or hardcoded
    // by `mergeFrameworkNav` for the framework section). Section
    // headers keep the top-level visual scaffold; individual pages can
    // opt into icons with `showIcon: true` in frontmatter for targeted
    // cases like partner cookbook entries.
    //
    // We MERGE icon + title into Fumadocs's `name` prop as a Fragment
    // instead of passing the icon via the separate `icon` prop. The
    // upstream `SidebarSeparator` renders `[item.icon, item.name]` as
    // a child array, which triggers the React key-warning loop when
    // both slots are populated. Combining them into a single ReactNode
    // sidesteps that without forking Fumadocs. The separator's
    // `inline-flex items-center gap-2` styling still aligns the SVG
    // and label exactly as it would have with the prop split.
    const icon = resolveSidebarIcon(node.icon);
    const name = renderNavName(node.title, node.variant, icon, {
      quickstartHref: node.quickstartHref,
      referenceHref: node.referenceHref,
      frontendDocsStatus: node.frontendDocsStatus,
    });
    return [{ type: "separator", name }];
  }
  if (node.type === "page") {
    const icon = resolveSidebarIcon(node.icon);
    return [
      {
        type: "page",
        name: renderNavName(node.title, node.variant, icon),
        url: node.href ?? buildUrl(slugHrefPrefix, node.slug),
      },
    ];
  }
  // group
  const childNodes = node.children.flatMap((c) =>
    navNodeToPageTreeNodes(c, slugHrefPrefix),
  );
  if (!node.title) {
    // Untitled group: inline its children at the parent level. No
    // folder wrapper, no orphan chevron.
    return childNodes;
  }
  // If one of the group's NavNode children is a page representing the
  // folder's own `index.mdx` (slug === `${group.slug}/index`), lift it
  // into `folder.index` so Fumadocs renders the folder name itself as a
  // link to that page instead of a separate "Overview" entry inside the
  // expanded folder. The URL drops the `/index` suffix so the canonical
  // folder root (e.g. `/agentic-protocols`) is what the link points at.
  const indexNavIdx = node.children.findIndex(
    (c) => c.type === "page" && c.slug === `${node.slug}/index`,
  );
  let folderIndex: PageTree.Item | undefined;
  let folderChildren: PageTree.Node[] = childNodes;
  if (indexNavIdx >= 0) {
    const lifted = childNodes[indexNavIdx];
    if (lifted && lifted.type === "page") {
      const url = lifted.url.endsWith("/index")
        ? lifted.url.slice(0, -"/index".length)
        : lifted.url;
      folderIndex = { ...lifted, url };
      folderChildren = childNodes.filter((_, i) => i !== indexNavIdx);
    }
  }
  return [
    {
      type: "folder",
      name: renderNavName(node.title, node.variant),
      // Inline-folder groups (from a meta.json `{ title, pages, defaultOpen }`
      // entry) can opt into starting expanded; everything else stays
      // collapsed by default and Fumadocs still auto-opens the folder
      // containing the active page via its own `path.includes(item)`
      // fallback.
      defaultOpen: node.defaultOpen ?? false,
      ...(folderIndex ? { index: folderIndex } : {}),
      children: folderChildren,
    },
  ];
}

// Cache by the (memoized) NavNode[] reference so successive calls with
// the same tree + prefix skip re-allocating the PageTree. `buildNavTree`
// returns the same reference for the same `(dir, prefix)` in prod, so
// this caches the full PageTree per route surface.
const isDev = process.env.NODE_ENV === "development";
const pageTreeCache = new WeakMap<NavNode[], Map<string, PageTree.Root>>();

export function navTreeToPageTree(
  tree: NavNode[],
  slugHrefPrefix: string,
  rootName: string = "Docs",
): PageTree.Root {
  if (!isDev) {
    let perTree = pageTreeCache.get(tree);
    const subKey = `${slugHrefPrefix}|${rootName}`;
    const hit = perTree?.get(subKey);
    if (hit) return hit;
    const built: PageTree.Root = {
      name: rootName,
      children: tree.flatMap((n) => navNodeToPageTreeNodes(n, slugHrefPrefix)),
    };
    if (!perTree) {
      perTree = new Map();
      pageTreeCache.set(tree, perTree);
    }
    perTree.set(subKey, built);
    return built;
  }
  return {
    name: rootName,
    children: tree.flatMap((n) => navNodeToPageTreeNodes(n, slugHrefPrefix)),
  };
}
