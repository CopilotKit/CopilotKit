import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as PageTree from "fumadocs-core/page-tree";
import type { NavNode } from "../docs-render";
import {
  SECTION_FOLDER_LABEL_CLASS,
  navTreeToPageTree,
  wrapSectionSeparatorsAsFolders,
} from "../page-tree-bridge";

function nodeNameText(name: React.ReactNode): string {
  return renderToStaticMarkup(React.createElement(React.Fragment, null, name));
}

function folderNamed(
  nodes: PageTree.Node[],
  title: string,
): PageTree.Folder | undefined {
  return nodes.find(
    (node): node is PageTree.Folder =>
      node.type === "folder" && nodeNameText(node.name).includes(title),
  );
}

describe("navTreeToPageTree section folders", () => {
  const navTree: NavNode[] = [
    { type: "section", title: "Concepts", icon: "lucide/BookOpen" },
    { type: "page", title: "Architecture", slug: "concepts/architecture" },
    { type: "page", title: "Which Hook", slug: "concepts/which-hook" },
    { type: "section", title: "Basics" },
    { type: "page", title: "Quickstart", slug: "quickstart" },
    {
      type: "group",
      title: "Rich Threads",
      slug: "threads",
      children: [{ type: "page", title: "Threads", slug: "threads" }],
    },
    { type: "section", title: "Build Generative UI" },
    {
      type: "group",
      title: "",
      slug: "generative-ui",
      children: [
        { type: "page", title: "Generative UI", slug: "generative-ui" },
      ],
    },
    {
      type: "section",
      title: "Vue",
      variant: "frontend-docs-upcoming",
    },
  ];

  const pageTree = navTreeToPageTree(navTree, "");

  it("turns labeled sections into collapsed folders", () => {
    const concepts = folderNamed(pageTree.children, "Concepts");
    const basics = folderNamed(pageTree.children, "Basics");

    expect(concepts).toBeDefined();
    expect(basics).toBeDefined();
    expect(concepts?.defaultOpen).toBe(false);
    expect(basics?.defaultOpen).toBe(false);
    expect(concepts?.icon).toBeTruthy();
    expect(nodeNameText(concepts?.name)).toContain(SECTION_FOLDER_LABEL_CLASS);
    expect(
      concepts?.children
        .filter((child): child is PageTree.Item => child.type === "page")
        .map((child) => child.url),
    ).toEqual(["/concepts/architecture", "/concepts/which-hook"]);
    expect(
      basics?.children
        .filter((child): child is PageTree.Item => child.type === "page")
        .map((child) => child.url),
    ).toEqual(["/quickstart"]);
  });

  it("keeps nested groups inside the parent section folder", () => {
    const basics = folderNamed(pageTree.children, "Basics");
    const threads = folderNamed(basics?.children ?? [], "Rich Threads");

    expect(threads?.type).toBe("folder");
    expect(
      threads?.children
        .filter((child): child is PageTree.Item => child.type === "page")
        .map((child) => child.url),
    ).toEqual(["/threads"]);
  });

  it("folds untitled groups into the section above them", () => {
    const generative = folderNamed(pageTree.children, "Build Generative UI");

    expect(
      generative?.children
        .filter((child): child is PageTree.Item => child.type === "page")
        .map((child) => child.url),
    ).toEqual(["/generative-ui"]);
  });

  it("leaves empty trailing separators as labels", () => {
    const upcoming = pageTree.children.find(
      (node) =>
        node.type === "separator" &&
        nodeNameText(node.name).includes("Guides coming soon"),
    );

    expect(upcoming?.type).toBe("separator");
  });
});

describe("wrapSectionSeparatorsAsFolders", () => {
  it("keeps pages that sit above the first section", () => {
    const wrapped = wrapSectionSeparatorsAsFolders([
      { type: "page", name: "Overview", url: "/" },
      { type: "separator", name: "Concepts" },
      { type: "page", name: "Architecture", url: "/concepts/architecture" },
    ]);

    expect(wrapped.map((node) => node.type)).toEqual(["page", "folder"]);
    expect(wrapped[0]).toMatchObject({ type: "page", url: "/" });
  });

  it("keeps an empty section as a separator", () => {
    const wrapped = wrapSectionSeparatorsAsFolders([
      { type: "separator", name: "Lonely" },
    ]);

    expect(wrapped).toEqual([{ type: "separator", name: "Lonely" }]);
  });
});
