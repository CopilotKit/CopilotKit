import { describe, expect, it } from "vitest";
import {
  buildFrameworkSearchOptions,
  parseChannelDocsHref,
  reconcileFrameworkSearchSelection,
  resolveChannelSearchHrefs,
  frameworkDocsHref,
  normalizeHref,
  parseDocsHref,
  parseIntegrationDocsHref,
} from "@/lib/search-hrefs";

describe("search href helpers", () => {
  it("serves built-in-agent framework search results at the root", () => {
    expect(frameworkDocsHref("built-in-agent", "")).toBe("/");
    expect(frameworkDocsHref("built-in-agent", "quickstart")).toBe(
      "/quickstart",
    );
    expect(frameworkDocsHref("mastra", "quickstart")).toBe(
      "/mastra/quickstart",
    );
  });

  it("preserves the active frontend when building framework search results", () => {
    expect(frameworkDocsHref("built-in-agent", "", "vue")).toBe("/vue");
    expect(frameworkDocsHref("built-in-agent", "quickstart", "vue")).toBe(
      "/vue",
    );
    expect(frameworkDocsHref("langgraph-python", "quickstart", "vue")).toBe(
      "/vue/langgraph-python",
    );
    expect(
      frameworkDocsHref("mastra", "concepts/architecture", "react-native"),
    ).toBe("/react-native/mastra/concepts/architecture");
    expect(
      frameworkDocsHref("built-in-agent", "backend/copilot-runtime", "angular"),
    ).toBe("/angular/backend/copilot-runtime");
    expect(frameworkDocsHref("langgraph-python", "auth", "angular")).toBe(
      "/angular/langgraph-python/auth",
    );
  });

  it("normalizes built-in-agent docs index hrefs to root URLs", () => {
    expect(normalizeHref("/docs/built-in-agent", "https://shell.test")).toBe(
      "/",
    );
    expect(
      normalizeHref("/docs/integrations/built-in-agent", "https://shell.test"),
    ).toBe("/");
    expect(
      normalizeHref(
        "/docs/integrations/built-in-agent/server-tools",
        "https://shell.test",
      ),
    ).toBe("/server-tools");
  });

  it("keeps non-root docs and shell links on their expected hosts", () => {
    expect(normalizeHref("/docs/quickstart", "https://shell.test")).toBe(
      "/quickstart",
    );
    expect(normalizeHref("/docs/frontends/vue", "https://shell.test")).toBe(
      "/vue",
    );
    expect(
      normalizeHref(
        "/docs/frontends/react-native/using-these-docs",
        "https://shell.test",
      ),
    ).toBe("/react-native/using-these-docs");
    expect(
      normalizeHref("/docs/frontends/using-these-docs", "https://shell.test"),
    ).toBe("/vue/using-these-docs");
    expect(
      normalizeHref("/docs/frontends/docs-status", "https://shell.test"),
    ).toBe("/vue/using-these-docs");
    expect(normalizeHref("/integrations", "https://shell.test")).toBe(
      "https://shell.test/integrations",
    );
  });

  it("parses docs href categories", () => {
    expect(parseDocsHref("/docs/quickstart")).toBe("quickstart");
    expect(parseDocsHref("/docs/integrations/mastra/quickstart")).toBeNull();
    expect(parseDocsHref("/docs/frontends/vue")).toBeNull();
    expect(
      parseIntegrationDocsHref("/docs/integrations/mastra/quickstart"),
    ).toEqual({ folder: "mastra", topic: "quickstart" });
  });

  it("parses only registered shared Channels guide sources", () => {
    expect(parseChannelDocsHref("/docs/channels")).toBeNull();
    expect(parseChannelDocsHref("/docs/channels/tools")).toEqual({
      topic: "tools",
    });
    expect(parseChannelDocsHref("/docs/channels/reference/thread")).toBeNull();
    expect(parseChannelDocsHref("/docs/channels/not-a-guide")).toBeNull();
    expect(parseChannelDocsHref("/docs/channels/tools/")).toBeNull();
    expect(parseChannelDocsHref("/docs/channels?view=all")).toBeNull();
  });

  it("fails closed for unknown sources in the Channels namespace", () => {
    expect(parseDocsHref("/docs/channels/not-a-guide")).toBeNull();
    expect(parseDocsHref("/docs/channels/tools")).toBeNull();
    expect(parseDocsHref("/docs/channels?view=all")).toBeNull();
    expect(parseDocsHref("/docs/channels-but-not-the-namespace")).toBe(
      "channels-but-not-the-namespace",
    );
  });

  it("resolves one channel guide destination on an active channel surface", () => {
    expect(resolveChannelSearchHrefs("tools", "mastra", "slack")).toEqual([
      { frontend: "slack", href: "/slack/mastra/tools" },
    ]);
    expect(
      resolveChannelSearchHrefs(
        "threads-and-state",
        "langgraph-fastapi",
        "teams",
      ),
    ).toEqual([
      {
        frontend: "teams",
        href: "/teams/langgraph-fastapi/threads-and-state",
      },
    ]);
  });

  it("resolves both provider destinations outside a channel surface", () => {
    expect(resolveChannelSearchHrefs("tools", "mastra", null)).toEqual([
      { frontend: "slack", href: "/slack/mastra/tools" },
      { frontend: "teams", href: "/teams/mastra/tools" },
    ]);
    expect(resolveChannelSearchHrefs("tools", "mastra", "vue")).toEqual([
      { frontend: "slack", href: "/slack/mastra/tools" },
      { frontend: "teams", href: "/teams/mastra/tools" },
    ]);
  });

  it("omits the removed overview and collapses Built-in Agent guide URLs", () => {
    expect(resolveChannelSearchHrefs("", "mastra", null)).toEqual([]);
    expect(
      resolveChannelSearchHrefs("interactive", "built-in-agent", null),
    ).toEqual([
      { frontend: "slack", href: "/slack/interactive" },
      { frontend: "teams", href: "/teams/interactive" },
    ]);
    expect(
      resolveChannelSearchHrefs("not-a-guide", "built-in-agent", null),
    ).toEqual([]);
  });

  it("preserves a server-known docs-only framework after client registry load", () => {
    const options = buildFrameworkSearchOptions(
      [
        {
          slug: "built-in-agent",
          name: "CopilotKit's Built-in Agent",
          docs_mode: "authored",
        },
        { slug: "mastra", name: "Mastra", docs_mode: "authored" },
        { slug: "langroid", name: "Langroid", docs_mode: "hidden" },
      ],
      ["built-in-agent", "mastra", "langroid", "deepagents"],
    );
    const selectedFramework = reconcileFrameworkSearchSelection(
      "deepagents",
      options,
    );

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "deepagents",
          name: "Deep Agents",
          logo: null,
        }),
      ]),
    );
    expect(options.some((option) => option.slug === "langroid")).toBe(false);
    expect(options.some((option) => option.slug === "unknown-framework")).toBe(
      false,
    );
    expect(selectedFramework).toBe("deepagents");
    expect(
      resolveChannelSearchHrefs("tools", selectedFramework, "slack"),
    ).toEqual([
      {
        frontend: "slack",
        href: "/slack/deepagents/tools",
      },
    ]);
  });

  it("falls back from hidden or unknown framework selections", () => {
    const options = buildFrameworkSearchOptions(
      [
        {
          slug: "built-in-agent",
          name: "CopilotKit's Built-in Agent",
          docs_mode: "authored",
        },
        { slug: "langroid", name: "Langroid", docs_mode: "hidden" },
      ],
      ["built-in-agent", "langroid"],
    );

    expect(reconcileFrameworkSearchSelection("langroid", options)).toBe(
      "built-in-agent",
    );
    expect(
      reconcileFrameworkSearchSelection("unknown-framework", options),
    ).toBe("built-in-agent");
  });
});
