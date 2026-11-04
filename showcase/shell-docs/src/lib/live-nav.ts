import type * as PageTree from "fumadocs-core/page-tree";
import type { FrontendId } from "@/proto/data";
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
  frontendPolicy,
  liveSource,
  referenceSource,
} from "./live-source";

/**
 * The live docs' sidebars, from shell-docs' own meta.json files: the root one
 * (unscoped pages, which are the built-in agent's), one per folder under
 * `docs/integrations` for frameworks that author their own, and the reference's
 * and the cookbook's. The layout picks
 * and scopes one per URL on the client (`src/proto/live-tree.tsx`).
 */
export interface LiveNav {
  root: PageTree.Node[];
  /** Keyed by integrations folder; URLs still read `/integrations/<folder>/...`. */
  folders: Record<string, PageTree.Node[]>;
  /**
   * What a generated framework adds to the root sidebar: its folder's pages
   * that have no root page of the same slug (`buildFrameworkOverridesNav`).
   */
  overrides: Record<string, PageTree.Node[]>;
  /** The reference's sidebar per SDK (`v2`, `vue`, ...), at final URLs. */
  reference: Record<string, PageTree.Node[]>;
  /** The cookbook's recipes, from `docs/cookbook/meta.json`. */
  cookbook: PageTree.Node[];
  /**
   * The unscoped pages Vue and Angular serve, by slug. Their sidebars list
   * only these, plus, on Angular, the backend's own pages
   * (`src/lib/live-frontend-sidebar.ts`).
   */
  frontendPages: Partial<Record<FrontendId, string[]>>;
}

let cached: LiveNav | undefined;

export function getLiveNav(): LiveNav {
  if (cached) return cached;
  const folders: Record<string, PageTree.Node[]> = {};
  const overrides: Record<string, PageTree.Node[]> = {};
  for (const fw of Object.values(LIVE_FRAMEWORKS)) {
    const tree = () =>
      strip(folderSource(`integrations/${fw.folder}`).getPageTree().children);
    if (fw.mode === "authored") folders[fw.folder] ??= tree();
    else overrides[fw.folder] ??= withoutRootPages(tree(), fw.folder);
  }
  cached = {
    root: strip(liveSource.getPageTree().children),
    folders,
    overrides,
    reference: referenceNav(),
    cookbook: strip(folderSource("cookbook").getPageTree().children, true),
    frontendPages: {
      vue: frontendPages("vue"),
      angular: frontendPages("angular"),
    },
  };
  return cached;
}

/**
 * Pages Vue reuses although they predate the frontend policy
 * (shell-docs' `VUE_SHARED_ROOT_DOC_SLUGS`).
 */
const VUE_SHARED_PAGES = ["AG-UI-Streams", "threads-import", "inspector"];

/**
 * What a frontend serves beyond its quickstart, as shell-docs'
 * `frontend-doc-policy.ts` decides it: its own pages
 * (`frontends/vue/frontend-tools.mdx` is `frontend-tools`) and every page
 * whose policy is `universal`. A React page with neither is left out.
 */
function frontendPages(frontend: FrontendId): string[] {
  const out = new Set(frontend === "vue" ? VUE_SHARED_PAGES : []);
  for (const page of liveSource.getPages()) {
    const [head, ...rest] = page.slugs;
    if (head === "frontends") {
      if (rest[0] === frontend) out.add(rest.slice(1).join("/"));
    } else if (
      head !== "integrations" &&
      frontendPolicy(page) === "universal"
    ) {
      out.add(page.slugs.join("/"));
    }
  }
  return [...out];
}

function withoutRootPages(
  nodes: PageTree.Node[],
  folder: string,
): PageTree.Node[] {
  const base = `/integrations/${folder}`;
  return nodes.flatMap((n): PageTree.Node[] => {
    if (n.type === "separator") return [];
    if (n.type === "page") {
      const slugs = n.url.slice(base.length).split("/").filter(Boolean);
      return slugs.length && liveSource.getPage(slugs) ? [] : [n];
    }
    const children = withoutRootPages(
      n.index ? [n.index, ...n.children] : n.children,
      folder,
    );
    return children.length ? [{ ...n, index: undefined, children }] : [];
  });
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
      return [{ type: "page", name: n.name, url: n.url, icon }];
    }
    if (n.type === "separator") return [{ type: "separator", name: n.name }];
    const index = n.index
      ? ({ type: "page", name: n.index.name, url: n.index.url } as const)
      : undefined;
    const children = strip(n.children, icons);
    // A folder whose pages all sit elsewhere in the sidebar would render as an
    // empty, expandable row: show its own page as a plain link, or drop it.
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

/** Turns `live-source.ts`' group markers back into folders. */
function foldGroups(nodes: PageTree.Node[]): PageTree.Node[] {
  const out: PageTree.Node[] = [];
  let group: PageTree.Folder | null = null;
  for (const n of nodes) {
    const name =
      n.type === "separator" && typeof n.name === "string" ? n.name : null;
    if (name?.startsWith(GROUP_OPEN_EXPANDED) || name?.startsWith(GROUP_OPEN)) {
      const open = name.startsWith(GROUP_OPEN_EXPANDED);
      group = {
        type: "folder",
        name: name.slice((open ? GROUP_OPEN_EXPANDED : GROUP_OPEN).length),
        defaultOpen: open,
        children: [],
      };
      out.push(group);
    } else if (name === GROUP_CLOSE) {
      group = null;
    } else if (group) {
      group.children.push(n);
    } else {
      out.push(n);
    }
  }
  return out;
}
