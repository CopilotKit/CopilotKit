"use client";

import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";
import { SiTypescript } from "react-icons/si";
import {
  AgentsGlyph,
  BackendGlyph,
  BasicsGlyph,
  CapabilitiesGlyph,
  DocsGlyph,
  GenerativeUIGlyph,
  IntelligenceGlyph,
  InteractivityGlyph,
  OtherGlyph,
  QuickstartGlyph,
} from "@/components/icons/glyphs";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { FrontendLogo } from "@/components/icons/frontend-logo";
import { CATALOG_REFERENCE_PATH } from "@/components/standard-catalog/catalog-reference";
import type { LiveNav } from "@/lib/live-nav";
import { LINK_ROW, whereIs } from "@/lib/live-pages";
import {
  LIVE_FRAMEWORKS,
  REFERENCE_ROOT_VERSION,
  ROOT_FRAMEWORK,
  UNSCOPED_SEGMENTS,
  isChannel,
  scopeFromPath,
} from "@/lib/live-scope";
import type { FrontendId } from "./data";
import { frameworkById } from "./data";

/**
 * The live sidebar for a URL (`src/lib/live-nav.ts` has its parts): the
 * frontend's outline (the app frontends share `docs/meta.json`, Slack and
 * Teams `docs/channels/meta.json`), the framework's own pages first in
 * "Agent capabilities", then the shared sections every frontend ends with.
 * A row shows only when its page exists for the URL's frontend and framework
 * (`whereIs`), so each stack sees the pages it has and nothing else. Links
 * stay in the URL's scope; section headings and the top rows take D's accent
 * and glyphs.
 */
export function liveTree(nav: LiveNav, pathname: string): PageTree.Root {
  const path = pathname.split("/").filter(Boolean);
  if (path[0] === "reference") {
    const sdk = nav.reference[path[1]] ? path[1] : REFERENCE_ROOT_VERSION;
    return { name: "Reference", children: referenceTree(nav, sdk) };
  }
  if (path[0] === "cookbook") {
    return { name: "Cookbook", children: nav.cookbook.map(recipeIcon) };
  }

  const scope = scopeFromPath(path);
  const outline = isChannel(scope.frontend)
    ? fromTree(nav.channels, "/channels")
    : fromTree(nav.app, "");
  const sidebar = [
    ...withFrameworkPages(outline, frameworkGroup(nav, scope.framework)),
    ...fromTree(nav.shared, "/(shared)"),
  ];
  const draw = drawer(nav, scope);
  return {
    name: "Docs",
    children: dropEmptySections(
      sidebar.flatMap((n, i) => draw(n, isTopRow(sidebar, i))),
    ),
  };
}

type NavPage = {
  type: "page";
  title: string;
  slug: string;
  href?: string;
  /** The outline names the row (a meta.json link), so it keeps that title. */
  named?: boolean;
};
type NavNode =
  | NavPage
  | { type: "section"; title: string }
  | {
      type: "group";
      title: string;
      defaultOpen?: boolean;
      index?: NavPage;
      children: NavNode[];
    };

/**
 * A meta.json outline as rows, with each page's slug relative to `base`
 * (`/channels/tools` is `tools`). A link entry (`[Title](/intelligence/overview)`)
 * is a page at its path; one to a section that isn't per stack (`/reference`,
 * `/cookbook`) or off site keeps its href.
 */
function fromTree(nodes: PageTree.Node[], base: string): NavNode[] {
  const page = (n: PageTree.Item): NavPage => {
    const title = typeof n.name === "string" ? n.name : "";
    const named = n.description === LINK_ROW;
    if (/^https?:/.test(n.url))
      return { type: "page", title, slug: "", href: n.url };
    const own = n.url === base || n.url.startsWith(`${base}/`);
    const slug = (own ? n.url.slice(base.length) : n.url).replace(
      /^\/+|\/+$/g,
      "",
    );
    return UNSCOPED_SEGMENTS.has(slug.split("/")[0])
      ? { type: "page", title, slug, href: `/${slug}` }
      : { type: "page", title, slug, named };
  };
  return nodes.map((n): NavNode => {
    if (n.type === "separator") {
      return {
        type: "section",
        title: typeof n.name === "string" ? n.name : "",
      };
    }
    if (n.type === "page") return page(n);
    return {
      type: "group",
      title: typeof n.name === "string" ? n.name : "",
      defaultOpen: n.defaultOpen,
      index: n.index ? page(n.index) : undefined,
      children: fromTree(n.children, base),
    };
  });
}

const CAPABILITIES = "Agent capabilities";
const CATALOG = CATALOG_REFERENCE_PATH.replace(/^\//, "");

/**
 * The framework's own pages as one folder named for it (its landing and
 * quickstart are the top rows, so they're left out).
 */
function frameworkGroup(
  nav: LiveNav,
  framework: string | null,
): NavNode | null {
  const slug = framework ?? ROOT_FRAMEWORK;
  const folder = LIVE_FRAMEWORKS[slug]?.folder;
  const own = folder ? nav.frameworks[folder] : undefined;
  if (!own) return null;
  const children = fromTree(own.nodes, `/integrations/${folder}`).filter(
    (n) =>
      n.type === "group" ||
      (n.type === "page" && n.slug !== "" && n.slug !== "quickstart"),
  );
  if (!children.length) return null;
  const title =
    slug === ROOT_FRAMEWORK
      ? (own.title ?? "Built-in Agent")
      : (frameworkById(slug)?.name ?? own.title ?? slug);
  return { type: "group", title, children };
}

/** The framework's folder leads "Agent capabilities", which is added if missing. */
function withFrameworkPages(outline: NavNode[], group: NavNode | null) {
  if (!group) return outline;
  const at = outline.findIndex(
    (n) => n.type === "section" && n.title === CAPABILITIES,
  );
  return at === -1
    ? [...outline, { type: "section", title: CAPABILITIES } as const, group]
    : [...outline.slice(0, at + 1), group, ...outline.slice(at + 1)];
}

/** Rows before the first section heading: Quickstart, Build with agents, Intelligence. */
function isTopRow(sidebar: NavNode[], i: number) {
  return !sidebar.slice(0, i + 1).some((n) => n.type === "section");
}

/** Each frontend's own reference, from the outline's Reference row. */
const REFERENCE_FOR: Record<FrontendId, string> = {
  react: "/reference",
  vue: "/reference/vue",
  angular: "/reference/angular",
  "react-native": "/reference/react-native",
  slack: "/reference/channels",
  teams: "/reference/channels",
};

/**
 * Draws a row in the URL's scope, or nothing when its page doesn't exist
 * there. A frontend's own page takes its own title (Vue's "Frontend Tools"),
 * except in the top rows, which keep the outline's.
 */
function drawer(nav: LiveNav, scope: ReturnType<typeof scopeFromPath>) {
  // The standard catalog's component pages (`withCatalogNav`) are generated
  // from the catalog, so they exist wherever the catalog page does.
  const find = (slug: string) =>
    whereIs(
      nav.index,
      scope.frontend,
      scope.framework,
      slug.startsWith(`${CATALOG}/`) ? CATALOG : slug,
    );
  const item = (p: NavPage, top: boolean): PageTree.Item | null => {
    const icon =
      top && ROW_GLYPHS[p.slug] ? (
        <span className={SECTION_ACCENT}>{ROW_GLYPHS[p.slug]}</span>
      ) : undefined;
    if (p.href) {
      const url =
        p.href === "/reference" ? REFERENCE_FOR[scope.frontend] : p.href;
      return {
        type: "page",
        name: p.title,
        url,
        icon,
        external: /^https?:/.test(url),
      };
    }
    const at = find(p.slug);
    if (!at) return null;
    const slug = at.kind === "frontend" ? at.slug : p.slug;
    const name =
      at.kind === "frontend" && !top && !p.named
        ? (nav.titles[at.folder]?.[at.slug] ?? p.title)
        : p.title;
    return {
      type: "page",
      name,
      url: `${scope.prefix}/${slug}`.replace(/\/$/, "") || "/",
      icon,
    };
  };
  const draw = (n: NavNode, top: boolean): PageTree.Node[] => {
    if (n.type === "section") {
      return [
        {
          type: "separator",
          name: <span className={SECTION_ACCENT}>{n.title}</span>,
          icon: (
            <span className={SECTION_ACCENT}>
              {SECTION_GLYPHS[n.title] ?? <AgentsGlyph />}
            </span>
          ),
        },
      ];
    }
    if (n.type === "page") {
      const row = item(n, top);
      return row ? [row] : [];
    }
    const index = n.index ? item(n.index, false) : null;
    const children = n.children.flatMap((c) => draw(c, false));
    // A folder with nothing left shows its own page as a plain link, or goes.
    if (!children.some((c) => c.type !== "separator"))
      return index ? [index] : [];
    return [
      {
        type: "folder",
        name: n.title,
        defaultOpen: n.defaultOpen,
        index: index ?? undefined,
        children,
      },
    ];
  };
  return draw;
}

/**
 * The reference's SDKs in shell-docs' order (`REFERENCE_VERSIONS`), each with
 * its own mark. React's v1 reference nests under React.
 */
const REFERENCE_SDKS: [sdk: string, name: string, icon: ReactNode][] = [
  ["v2", "React", <FrontendLogo key="react" icon="react" size={16} />],
  [
    "react-native",
    "React Native",
    <FrontendLogo key="react-native" icon="react-native" size={16} />,
  ],
  ["vue", "Vue", <FrontendLogo key="vue" icon="vue" size={16} />],
  [
    "angular",
    "Angular",
    <FrontendLogo key="angular" icon="angular" size={16} />,
  ],
  [
    "core",
    "TypeScript",
    <SiTypescript
      key="core"
      aria-hidden
      size={16}
      className="text-[#3178c6] dark:text-[#6fa8ec]"
    />,
  ],
  [
    "channels",
    "Channels",
    <FrameworkLogo key="channels" slug="built-in-agent" size={16} />,
  ],
];

/**
 * Every SDK's reference as a folder that opens on its overview, so any SDK is
 * one click away; the one in the URL starts open.
 */
function referenceTree(nav: LiveNav, current: string): PageTree.Node[] {
  const v1 = sdkFolder(nav, "v1", "v1", current === "v1");
  return REFERENCE_SDKS.flatMap(([sdk, name, icon]): PageTree.Node[] => {
    const nested = sdk === "v2" && v1 ? [v1] : [];
    const folder = sdkFolder(
      nav,
      sdk,
      name,
      sdk === current || !!nested[0]?.defaultOpen,
    );
    if (!folder) return [];
    return [{ ...folder, icon, children: [...folder.children, ...nested] }];
  });
}

function sdkFolder(
  nav: LiveNav,
  sdk: string,
  name: string,
  defaultOpen: boolean,
): PageTree.Folder | undefined {
  const nodes = nav.reference[sdk];
  if (!nodes?.length) return undefined;
  const [first, ...rest] = nodes;
  const index =
    first.type === "page" && first.url === `/reference/${sdk}`
      ? first
      : undefined;
  return {
    type: "folder",
    name,
    defaultOpen,
    index,
    children: index ? rest : nodes,
  };
}

function dropEmptySections(nodes: PageTree.Node[]): PageTree.Node[] {
  return nodes.filter(
    (n, i) =>
      n.type !== "separator" ||
      (nodes[i + 1] !== undefined && nodes[i + 1].type !== "separator"),
  );
}

/** Every sidebar section heading and its glyph take the sidebar's lilac. */
const SECTION_ACCENT = "text-sidebar-primary";

/** The same glyphs D's sidebar gave each section (`nav-d.ts`). */
const SECTION_GLYPHS: Record<string, ReactNode> = {
  "Getting Started": <QuickstartGlyph />,
  Build: <CapabilitiesGlyph />,
  Production: <BackendGlyph />,
  Basics: <BasicsGlyph />,
  "Generative UI": <GenerativeUIGlyph />,
  Interactivity: <InteractivityGlyph />,
  "Agent capabilities": <CapabilitiesGlyph />,
  Intelligence: <IntelligenceGlyph />,
  Backend: <BackendGlyph />,
  Learn: <DocsGlyph />,
  Other: <OtherGlyph />,
};

/** A cookbook row's frontmatter icon name drawn as its partner's logo. */
function recipeIcon(n: PageTree.Node): PageTree.Node {
  return n.type === "page" && typeof n.icon === "string"
    ? { ...n, icon: RECIPE_ICONS[n.icon] }
    : n;
}

function RecipeLogo({ src, className }: { src: string; className?: string }) {
  return (
    // oxlint-disable-next-line nextjs/no-img-element -- tiny static marks; next/image adds nothing here
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      className={`size-4 shrink-0 object-contain ${className ?? ""}`}
    />
  );
}

/** Each recipe's partner logo, as shell-docs drew them (`sidebar-icon.tsx`). */
const RECIPE_ICONS: Record<string, ReactNode> = {
  "lucide/BookOpen": <DocsGlyph />,
  "custom/daytona": (
    <RecipeLogo
      src="/logos/daytona.png"
      className="rounded-[3px] object-cover"
    />
  ),
  "custom/claude-managed-agents": <RecipeLogo src="/logos/claude.svg" />,
  "custom/arcade": <RecipeLogo src="/logos/arcade.png" />,
  "custom/oracle-agent-spec": <RecipeLogo src="/logos/oracle-agent-spec.png" />,
  "custom/openbox": <RecipeLogo src="/logos/openbox.png" />,
  "custom/typesafe": <RecipeLogo src="/logos/typesafe.svg" />,
  "custom/antigravity": <RecipeLogo src="/logos/antigravity.svg" />,
  "custom/manufact": (
    <RecipeLogo src="/logos/manufact.svg" className="dark:invert" />
  ),
  "custom/google-adk": <RecipeLogo src="/logos/google-adk.png" />,
};

/** The top rows: Quickstart, Build with agents, Intelligence. */
const ROW_GLYPHS: Record<string, ReactNode> = {
  quickstart: <QuickstartGlyph />,
  "build-with-agents": <AgentsGlyph />,
  "intelligence/overview": <IntelligenceGlyph />,
};
