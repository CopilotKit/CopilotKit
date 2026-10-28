"use client";

import type { ReactNode } from "react";
import type * as PageTree from "fumadocs-core/page-tree";
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
    return { name: "Reference", children: nav.reference[sdk] ?? [] };
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

/** The top rows: Quickstart, Build with agents, Intelligence. */
const ROW_GLYPHS: Record<string, ReactNode> = {
  play: <QuickstartGlyph />,
  brain: <AgentsGlyph />,
  kite: <IntelligenceGlyph />,
};
