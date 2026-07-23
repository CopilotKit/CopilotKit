import { describe, expect, it } from "vitest";
import {
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
});
