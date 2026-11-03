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
import type { LiveNav } from "@/lib/live-nav";
import {
  REFERENCE_ROOT_VERSION,
  ROOT_FRAMEWORK,
  liveFramework,
  scopeFromPath,
} from "@/lib/live-scope";
import {
  authoredSidebar,
  generatedSidebar,
  toNav,
  type NavNode,
} from "@/lib/live-sidebar";
import { frameworkById } from "./data";

/**
 * The live sidebar for a URL, built the way shell-docs builds production's
 * (`src/lib/live-sidebar.ts`): the root surface is the built-in agent's, a
 * framework that authors its docs gets its own meta.json, a generated one the
 * root tree plus its overrides. Every link stays in the URL's scope; section
 * headings and the top rows take D's accent and glyphs.
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
  const slug = scope.framework ?? ROOT_FRAMEWORK;
  const fw = liveFramework(slug);
  const root = toNav(nav.root);
  const sidebar =
    fw?.mode === "authored" && nav.folders[fw.folder]
      ? authoredSidebar(
          toNav(nav.folders[fw.folder], `/integrations/${fw.folder}`),
          root,
          !scope.framework,
        )
      : generatedSidebar(
          fw
            ? toNav(
                nav.overrides[fw.folder] ?? [],
                `/integrations/${fw.folder}`,
              )
            : [],
          root,
          frameworkById(slug)?.name ?? slug,
        );
  const href = (n: Extract<NavNode, { type: "page" }>) =>
    n.href ?? (`${scope.prefix}/${n.slug}`.replace(/\/$/, "") || "/");
  return {
    name: "Docs",
    children: dropEmptySections(sidebar.map((n) => node(n, href))),
  };
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

function node(
  n: NavNode,
  href: (page: Extract<NavNode, { type: "page" }>) => string,
): PageTree.Node {
  if (n.type === "section") {
    return {
      type: "separator",
      name: <span className={SECTION_ACCENT}>{n.title}</span>,
      icon: (
        <span className={SECTION_ACCENT}>
          {SECTION_GLYPHS[n.title] ?? <AgentsGlyph />}
        </span>
      ),
    };
  }
  if (n.type === "page") {
    return {
      type: "page",
      name: n.title,
      url: href(n),
      icon: n.icon ? (
        <span className={SECTION_ACCENT}>{ROW_GLYPHS[n.icon]}</span>
      ) : undefined,
    };
  }
  // A folder whose first page is its own (`human-in-the-loop`) links its title.
  const [first, ...rest] = n.children;
  const index =
    first?.type === "page" && first.slug === n.slug ? first : undefined;
  return {
    type: "folder",
    name: n.title,
    defaultOpen: n.defaultOpen,
    index: index ? (node(index, href) as PageTree.Item) : undefined,
    children: (index ? rest : n.children).map((c) => node(c, href)),
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
  play: <QuickstartGlyph />,
  brain: <AgentsGlyph />,
  kite: <IntelligenceGlyph />,
};
