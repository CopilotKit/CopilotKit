import { describe, expect, it } from "vitest";

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
        topic: "threads-and-state",
        title: "Threads and state",
        selectedFramework: "langgraph-fastapi",
        activeFrontend: "teams",
      }),
    ).toEqual([
      {
        frontend: "teams",
        groupKey: "channel:teams:threads-and-state",
        id: "docs:channel:teams:threads-and-state",
        title: "Threads and state",
        href: "/teams/langgraph-fastapi/threads-and-state",
      },
    ]);
  });

  it("creates a provider-scoped result for the Channels overview", () => {
    expect(
      resolveChannelSearchResults({
        topic: "overview",
        title: "Channels",
        selectedFramework: "mastra",
        activeFrontend: "slack",
      }),
    ).toEqual([
      {
        frontend: "slack",
        groupKey: "channel:slack:overview",
        id: "docs:channel:slack:overview",
        title: "Channels",
        href: "/slack/mastra",
      },
    ]);
  });
});
