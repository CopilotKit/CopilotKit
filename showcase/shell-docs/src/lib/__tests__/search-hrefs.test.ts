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
    expect(normalizeHref("/integrations", "https://shell.test")).toBe(
      "https://shell.test/integrations",
    );
  });

  it("parses docs href categories", () => {
    expect(parseDocsHref("/docs/quickstart")).toBe("quickstart");
    expect(parseDocsHref("/docs/integrations/mastra/quickstart")).toBeNull();
    expect(
      parseIntegrationDocsHref("/docs/integrations/mastra/quickstart"),
    ).toEqual({ folder: "mastra", topic: "quickstart" });
  });
});
