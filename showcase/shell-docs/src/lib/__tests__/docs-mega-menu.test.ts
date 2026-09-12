import { describe, expect, it } from "vitest";
import {
  DOCS_MEGA_MENU_COLUMNS,
  INTELLIGENCE_DOCS_HREF,
  isDocsExplorePath,
  isIntelligenceDocsPath,
} from "../docs-mega-menu";

describe("docs mega menu data", () => {
  it("keeps Intelligence as the featured Ship & Operate entry", () => {
    const titles = DOCS_MEGA_MENU_COLUMNS.map((column) => column.title);
    expect(titles).toEqual([
      "Start",
      "Build",
      "Connect",
      "Ship & Operate",
      "Reference",
    ]);

    const shipColumn = DOCS_MEGA_MENU_COLUMNS.find(
      (column) => column.title === "Ship & Operate",
    );
    const intelligence = shipColumn?.links.find(
      (link) => link.label === "Intelligence",
    );

    expect(INTELLIGENCE_DOCS_HREF).toBe("/intelligence/overview");
    expect(intelligence).toEqual({
      href: "/intelligence/overview",
      label: "Intelligence",
      icon: "kite",
      featured: true,
    });
    expect(shipColumn?.links.map((link) => [link.label, link.href])).toEqual([
      ["Intelligence", "/intelligence/overview"],
      ["Threads", "/threads"],
      ["Learning", "/backend/copilot-runtime"],
      ["Analytics", "/intelligence/managed-intelligence-platform"],
      ["Inspector", "/inspector"],
      ["Deploy", "/deploy/agentcore"],
      ["Self-hosting", "/intelligence/self-hosting"],
    ]);
  });
});

describe("isIntelligenceDocsPath", () => {
  it("matches Intelligence docs on the root and framework surfaces", () => {
    expect(isIntelligenceDocsPath("/intelligence/overview")).toBe(true);
    expect(isIntelligenceDocsPath("/intelligence/self-hosting")).toBe(true);
    expect(
      isIntelligenceDocsPath("/langgraph-python/intelligence/overview"),
    ).toBe(true);
    expect(isIntelligenceDocsPath("/premium/overview")).toBe(true);
    expect(isIntelligenceDocsPath("/quickstart")).toBe(false);
    expect(isIntelligenceDocsPath("/reference")).toBe(false);
  });
});

describe("isDocsExplorePath", () => {
  it("treats Intelligence and guide pages as Docs", () => {
    expect(isDocsExplorePath("/")).toBe(true);
    expect(isDocsExplorePath("/quickstart")).toBe(true);
    expect(isDocsExplorePath("/reference")).toBe(false);
    expect(isDocsExplorePath("/reference/hooks/useAgent")).toBe(false);
    expect(isDocsExplorePath("/cookbook")).toBe(false);
    expect(isDocsExplorePath("/intelligence/overview")).toBe(true);
    expect(isDocsExplorePath("/premium/overview")).toBe(true);
  });
});
