import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import searchIndex from "../../data/search-index.json";
import { CHANNEL_GUIDE_ROUTES } from "../channel-guide-routes";
import { resolveChannelSearchResults } from "../search-hrefs";

describe("Channels guide search results", () => {
  it("keeps provider results distinct and labeled outside channel surfaces", () => {
    const results = resolveChannelSearchResults({
      topic: "tools",
      title: "Tools and context",
      selectedFramework: "mastra",
      activeFrontend: null,
    });

    expect(results).toEqual([
      {
        frontend: "slack",
        groupKey: "channel:slack:tools",
        id: "docs:channel:slack:tools",
        title: "Tools and context — Slack",
        href: "/slack/mastra/tools",
      },
      {
        frontend: "teams",
        groupKey: "channel:teams:tools",
        id: "docs:channel:teams:tools",
        title: "Tools and context — Microsoft Teams",
        href: "/teams/mastra/tools",
      },
    ]);
    expect(new Set(results.map((result) => result.groupKey)).size).toBe(2);
    expect(new Set(results.map((result) => result.id)).size).toBe(2);
    expect(new Set(results.map((result) => result.href)).size).toBe(2);
  });

  it("returns only the active provider without adding a redundant label", () => {
    expect(
      resolveChannelSearchResults({
        topic: "reference/thread",
        title: "Thread API",
        selectedFramework: "langgraph-fastapi",
        activeFrontend: "teams",
      }),
    ).toEqual([
      {
        frontend: "teams",
        groupKey: "channel:teams:reference/thread",
        id: "docs:channel:teams:reference/thread",
        title: "Thread API",
        href: "/teams/langgraph-fastapi/reference/thread",
      },
    ]);
  });

  it("keeps the Channels overview as one global canonical result", () => {
    expect(
      resolveChannelSearchResults({
        topic: "",
        title: "Channels",
        selectedFramework: "mastra",
        activeFrontend: "slack",
      }),
    ).toEqual([
      {
        frontend: null,
        groupKey: "channel:overview",
        id: "docs:channel:overview",
        title: "Channels",
        href: "/channels",
      },
    ]);
  });
});

describe("generated Channels search index", () => {
  const docsIndexPath = path.resolve(
    process.cwd(),
    "src/data/search-index.json",
  );
  const shellIndexPath = path.resolve(
    process.cwd(),
    "../shell/src/data/search-index.json",
  );
  const generatorPath = path.resolve(
    process.cwd(),
    "../scripts/generate-search-index.ts",
  );

  it("contains every maintained shared Channels guide source", () => {
    const hrefs = searchIndex.map((entry) => entry.href);

    for (const route of CHANNEL_GUIDE_ROUTES) {
      expect(hrefs).toContain(`/docs/${route.sourceSlug}`);
    }
  });

  it("emits byte-identical indexes for shell-docs and shell", () => {
    expect(fs.readFileSync(docsIndexPath)).toEqual(
      fs.readFileSync(shellIndexPath),
    );
  });

  it("removes early-access guidance at the generator source and output", () => {
    const generatorSource = fs.readFileSync(generatorPath, "utf8");
    const serializedIndexes = [
      fs.readFileSync(docsIndexPath, "utf8"),
      fs.readFileSync(shellIndexPath, "utf8"),
    ].join("\n");

    expect(generatorSource).not.toMatch(/about early access/i);
    expect(serializedIndexes).not.toMatch(/early access/i);
    expect(generatorSource).toContain('{ id: "slack", name: "Slack" }');
    expect(generatorSource).toContain(
      '{ id: "teams", name: "Microsoft Teams" }',
    );
  });

  it("retains canonical frontend identities and docs-status expansions", () => {
    expect(searchIndex).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Slack", href: "/slack" }),
        expect.objectContaining({
          title: "Microsoft Teams",
          href: "/teams",
        }),
        expect.objectContaining({
          title: "Vue: Docs status",
          href: "/vue/using-these-docs",
        }),
        expect.objectContaining({
          title: "React Native: Docs status",
          href: "/react-native/using-these-docs",
        }),
        expect.objectContaining({
          title: "Angular: Docs status",
          href: "/angular/using-these-docs",
        }),
        expect.objectContaining({
          title: "Quickstart",
          href: "/docs/integrations/built-in-agent/quickstart",
        }),
      ]),
    );
    expect(
      searchIndex.some(
        (entry) =>
          entry.href === "/slack/using-these-docs" ||
          entry.href === "/teams/using-these-docs",
      ),
    ).toBe(false);
  });
});
