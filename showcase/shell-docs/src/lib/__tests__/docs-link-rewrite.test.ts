import { describe, expect, it } from "vitest";
import { resolveDocsHref } from "../docs-link-rewrite";

describe("resolveDocsHref", () => {
  it("scopes root-relative links under the active framework", () => {
    expect(
      resolveDocsHref("/quickstart#install", {
        slugHrefPrefix: "/mastra",
        frameworkOverride: "mastra",
      }),
    ).toBe("/mastra/quickstart#install");
  });

  it("does not scope cross-framework or reserved-route links", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/langgraph-python/quickstart", options)).toBe(
      "/langgraph-python/quickstart",
    );
    expect(resolveDocsHref("/reference/v2", options)).toBe("/reference/v2");
  });

  it("strips retired built-in-agent prefixes on the root surface", () => {
    const options = {
      slugHrefPrefix: "",
      frameworkOverride: undefined,
    };

    expect(resolveDocsHref("/built-in-agent/quickstart", options)).toBe(
      "/quickstart",
    );
    expect(
      resolveDocsHref(
        "/integrations/built-in-agent/quickstart?copilot-hosting=self-hosted#set-up-a-copilot-runtime-endpoint",
        options,
      ),
    ).toBe(
      "/quickstart?copilot-hosting=self-hosted#set-up-a-copilot-runtime-endpoint",
    );
  });

  it("strips retired built-in-agent prefixes before framework scoping", () => {
    const options = {
      slugHrefPrefix: "/mastra",
      frameworkOverride: "mastra",
    };

    expect(resolveDocsHref("/built-in-agent/server-tools", options)).toBe(
      "/server-tools",
    );
    expect(
      resolveDocsHref("/integrations/built-in-agent/model-selection", options),
    ).toBe("/model-selection");
  });
});
