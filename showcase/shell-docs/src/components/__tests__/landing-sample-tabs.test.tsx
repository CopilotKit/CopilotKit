import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LandingSampleTabs } from "../landing-sample-tabs";

vi.mock("fumadocs-ui/components/dynamic-codeblock", () => ({
  DynamicCodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

describe("LandingSampleTabs", () => {
  it("replaces the mobile preview with four simple cards", () => {
    const markup = renderToStaticMarkup(<LandingSampleTabs />);

    expect(markup).toContain('aria-label="CopilotKit mobile samples"');
    expect(markup).toContain("data-mobile-sample-card");
    expect(markup).toContain("sm:hidden");
    expect(markup).toMatch(/hidden[^"]*sm:block/);
    expect(markup).toContain("min-w-0 overflow-hidden");
    expect(markup).toContain(
      "Drop in a chat surface where your users already work.",
    );
    expect(markup).toContain(
      "Own every pixel and still use the agent runtime.",
    );
    expect(markup).toContain("Let agents render real React components.");
    expect(markup).toContain("Connect any backend that speaks AG-UI.");
    expect(markup.indexOf("Generative UI")).toBeLessThan(
      markup.indexOf("Any agent"),
    );
    expect(markup).not.toContain("overflow-x-auto");
    expect(markup).not.toContain("Open docs");
    expect(markup).not.toContain("min-h-[540px]");
  });
});
