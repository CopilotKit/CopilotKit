import type * as PageTree from "fumadocs-core/page-tree";
import { getPageIndex } from "./live-docs";
import { LINK_ROW } from "./live-pages";
import type { PageIndex } from "./live-pages";
import {
  LIVE_FRAMEWORKS,
  REFERENCE_FOLDERS,
  REFERENCE_ROOT_VERSION,
} from "./live-scope";
import {
  GROUP_CLOSE,
  GROUP_OPEN,
  GROUP_OPEN_EXPANDED,
  folderSource,
  liveSource,
  referenceSource,
} from "./live-source";

/**
 * The live docs' sidebars, read from their meta.json files and drawn per URL
 * on the client (`src/proto/live-tree.tsx`):
 *
 *   app         `docs/meta.json`: React, Vue, Angular, and React Native
 *   channels    `docs/channels/meta.json`: Slack and Teams
 *   shared      `docs/(shared)/meta.json`: the sections every frontend ends with
 *   frameworks  `docs/integrations/<folder>/meta.json`: a framework's own pages
 *
 * A row shows only when its page exists for the reader's frontend and
 * framework (`whereIs` over `index`).
 */
export interface LiveNav {
  app: PageTree.Node[];
  channels: PageTree.Node[];
  shared: PageTree.Node[];
  /**
   * A framework's own pages and its folder's sidebar title, keyed by
   * integrations folder; URLs read `/integrations/<folder>/...`.
   */
  frameworks: Record<string, { title?: string; nodes: PageTree.Node[] }>;
  /** The reference's sidebar per SDK (`v2`, `vue`, ...), at final URLs. */
  reference: Record<string, PageTree.Node[]>;
  /** The cookbook's recipes, from `docs/cookbook/meta.json`. */
  cookbook: PageTree.Node[];
  /** Where every page lives, for `whereIs`. */
  index: PageIndex;
  /** A frontend folder's own page titles, by folder then slug. */
  titles: Record<string, Record<string, string>>;
}

let cached: LiveNav | undefined;

export function getLiveNav(): LiveNav {
  if (cached) return cached;
  const index = getPageIndex();
  const frameworks: LiveNav["frameworks"] = {};
  for (const { folder } of Object.values(LIVE_FRAMEWORKS)) {
    if (frameworks[folder]) continue;
    const tree = folderSource(`integrations/${folder}`).getPageTree();
    frameworks[folder] = {
      title: typeof tree.name === "string" ? tree.name : undefined,
      nodes: strip(tree.children),
    };
  }
  const titles: Record<string, Record<string, string>> = {};
  for (const folder of Object.keys(index.folders)) {
    if (folder.startsWith("integrations/")) continue;
    titles[folder] = Object.fromEntries(
      index.folders[folder].flatMap((slug) => {
        const page = liveSource.getPage(
          `${folder}/${slug}`.split("/").filter(Boolean),
        );
        return page ? [[slug, page.data.title]] : [];
      }),
    );
  }
  cached = {
    app: strip(liveSource.getPageTree().children),
    channels: strip(folderSource("channels").getPageTree().children),
    shared: strip(folderSource("(shared)").getPageTree().children),
    frameworks,
    reference: referenceNav(),
    cookbook: strip(folderSource("cookbook").getPageTree().children, true),
    index,
    titles,
  };
  return cached;
}

/**
 * shell-docs shows one SDK's reference at a time. React's (`v2`) is the files
 * at the reference's root, served under `/reference/v2`; each other SDK is a
 * folder of its own.
 */
function referenceNav(): Record<string, PageTree.Node[]> {
  const out: Record<string, PageTree.Node[]> = { [REFERENCE_ROOT_VERSION]: [] };
  for (const node of strip(referenceSource.getPageTree().children)) {
    const sdk = node.type === "folder" ? sdkOf(node) : undefined;
    if (node.type === "folder" && sdk && REFERENCE_FOLDERS.has(sdk)) {
      out[sdk] = node.index ? [node.index, ...node.children] : node.children;
    } else {
      out[REFERENCE_ROOT_VERSION].push(
        withUrls(node, (url) =>
          url.replace(
            /^\/reference(?=\/|$)/,
            `/reference/${REFERENCE_ROOT_VERSION}`,
          ),
        ),
      );
    }
  }
  return out;
}

function sdkOf(folder: PageTree.Folder): string | undefined {
  const url = folder.index?.url ?? firstUrl(folder.children);
  return url?.match(/^\/reference\/([^/]+)/)?.[1];
}

function firstUrl(nodes: PageTree.Node[]): string | undefined {
  for (const n of nodes) {
    const url =
      n.type === "page"
        ? n.url
        : n.type === "folder"
          ? (n.index?.url ?? firstUrl(n.children))
          : undefined;
    if (url) return url;
  }
}

function withUrls(
  n: PageTree.Node,
  map: (url: string) => string,
): PageTree.Node {
  if (n.type === "page") return { ...n, url: map(n.url) };
  if (n.type === "separator") return n;
  return {
    ...n,
    index: n.index ? { ...n.index, url: map(n.index.url) } : undefined,
    children: n.children.map((c) => withUrls(c, map)),
  };
}

/**
 * D's sidebar draws rows without icons (section headings carry the glyphs),
 * and only plain data crosses to the client. The cookbook keeps each recipe's
 * frontmatter `icon` name (`custom/daytona`), which `live-tree.tsx` draws.
 */
function strip(nodes: PageTree.Node[], icons = false): PageTree.Node[] {
  return foldGroups(nodes).flatMap((n): PageTree.Node[] => {
    if (n.type === "page") {
      const icon = icons && typeof n.icon === "string" ? n.icon : undefined;
      // A meta.json link (`[Overview](/channels)`) names its row itself.
      const named = n.$ref ? {} : { description: LINK_ROW };
      return [{ type: "page", name: n.name, url: n.url, icon, ...named }];
    }
    if (n.type === "separator") return [{ type: "separator", name: n.name }];
    const index = n.index
      ? ({ type: "page", name: n.index.name, url: n.index.url } as const)
      : undefined;
    const children = strip(n.children, icons);
    if (!children.length) return index ? [index] : [];
    return [
      {
        type: "folder",
        name: n.name,
        defaultOpen: n.defaultOpen,
        index,
        children,
      },
    ];
  });
}

/** Turns `live-source.ts`' group markers back into folders, nested ones too. */
function foldGroups(nodes: PageTree.Node[]): PageTree.Node[] {
  const root: PageTree.Node[] = [];
  const open: PageTree.Folder[] = [];
  const into = () => open.at(-1)?.children ?? root;
  for (const n of nodes) {
    const name =
      n.type === "separator" && typeof n.name === "string" ? n.name : null;
    if (name?.startsWith(GROUP_OPEN_EXPANDED) || name?.startsWith(GROUP_OPEN)) {
      const expanded = name.startsWith(GROUP_OPEN_EXPANDED);
      const group: PageTree.Folder = {
        type: "folder",
        name: name.slice((expanded ? GROUP_OPEN_EXPANDED : GROUP_OPEN).length),
        defaultOpen: expanded,
        children: [],
      };
      into().push(group);
      open.push(group);
    } else if (name === GROUP_CLOSE) {
      open.pop();
    } else {
      into().push(n);
    }
  }
  return root;
}
