import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type * as PageTree from "fumadocs-core/page-tree";
import type { NavNode } from "../docs-render";
import { navTreeToPageTree } from "../page-tree-bridge";

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

describe("navTreeToPageTree sidebar hierarchy", () => {
  const navTree: NavNode[] = [
    { type: "page", title: "Introduction", slug: "" },
    { type: "page", title: "Quickstart", slug: "quickstart" },
    {
      type: "page",
      title: "Intelligence",
      slug: "intelligence/overview",
      icon: "custom/intelligence-kite",
    },
    { type: "section", title: "Basics" },
    {
      type: "group",
      title: "Chat",
      slug: "sidebar#chat",
      children: [
        { type: "page", title: "Prebuilt components", slug: "prebuilt" },
      ],
      defaultOpen: false,
    },
    {
      type: "group",
      title: "Rich threads",
      slug: "sidebar#rich-threads",
      children: [{ type: "page", title: "Overview", slug: "threads" }],
      defaultOpen: false,
    },
    { type: "section", title: "Generative UI" },
    {
      type: "group",
      title: "Controlled",
      slug: "sidebar#controlled",
      children: [{ type: "page", title: "Tools", slug: "tools" }],
      defaultOpen: false,
    },
    { type: "section", title: "Agent capabilities" },
    { type: "page", title: "WebMCP", slug: "webmcp" },
    { type: "section", title: "Intelligence", icon: "custom/copilotkit-kite" },
    { type: "page", title: "Overview", slug: "intelligence/overview" },
    { type: "section", title: "Learn" },
    {
      type: "page",
      title: "Cookbook",
      slug: "cookbook",
      href: "/cookbook",
      icon: "lucide/ArrowUpRight",
    },
    {
      type: "section",
      title: "Vue",
      variant: "frontend-docs-upcoming",
    },
  ];

  const pageTree = navTreeToPageTree(navTree, "");

  it("keeps the Intelligence CTA with start links and its section after agent capabilities", () => {
    expect(pageTree.children.slice(0, 4).map((node) => node.type)).toEqual([
      "page",
      "page",
      "page",
      "separator",
    ]);
    expect(pageTree.children[0]).toMatchObject({ type: "page", url: "/" });
    expect(pageTree.children[1]).toMatchObject({
      type: "page",
      url: "/quickstart",
    });
    expect(pageTree.children[2]).toMatchObject({
      type: "page",
      url: "/intelligence/overview",
    });
    expect(nodeNameText(pageTree.children[2]?.name)).toContain("<svg");

    const agentCapabilitiesIndex = pageTree.children.findIndex(
      (node) =>
        node.type === "separator" &&
        nodeNameText(node.name).includes("Agent capabilities"),
    );
    const intelligenceIndex = pageTree.children.findIndex(
      (node, index) =>
        index > agentCapabilitiesIndex &&
        node.type === "separator" &&
        nodeNameText(node.name).includes("Intelligence"),
    );
    expect(agentCapabilitiesIndex).toBeGreaterThan(-1);
    expect(intelligenceIndex).toBeGreaterThan(agentCapabilitiesIndex);

    const intelligenceSection = pageTree.children[intelligenceIndex];
    if (!intelligenceSection || intelligenceSection.type !== "separator") {
      throw new Error("expected Intelligence separator");
    }
    expect(nodeNameText(intelligenceSection.icon)).toContain("<svg");
    expect(pageTree.children[intelligenceIndex + 1]).toMatchObject({
      type: "page",
      url: "/intelligence/overview",
    });
  });

  it("keeps topic groups collapsible beneath static sections", () => {
    const chat = folderNamed(pageTree.children, "Chat");
    const threads = folderNamed(pageTree.children, "Rich threads");
    const controlled = folderNamed(pageTree.children, "Controlled");

    expect(chat?.defaultOpen).toBe(false);
    expect(threads?.defaultOpen).toBe(false);
    expect(controlled?.defaultOpen).toBe(false);
    expect(
      threads?.children
        .filter((child): child is PageTree.Item => child.type === "page")
        .map((child) => child.url),
    ).toEqual(["/threads"]);
  });

  it("leaves empty trailing separators as labels", () => {
    const upcoming = pageTree.children.find(
      (node) =>
        node.type === "separator" &&
        nodeNameText(node.name).includes("Guides coming soon"),
    );

    expect(upcoming?.type).toBe("separator");
  });

  it("places external-link icons after their labels", () => {
    const cookbook = pageTree.children.find(
      (node): node is PageTree.Item =>
        node.type === "page" && node.url === "/cookbook",
    );
    const markup = nodeNameText(cookbook?.name);

    expect(markup.indexOf("Cookbook")).toBeLessThan(markup.indexOf("<svg"));
  });
});
