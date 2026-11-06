// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createSSRApp, h } from "vue";
import type { Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { stylesheet } from "@copilotkit/core/styles";
import CopilotKitProvider from "../../providers/CopilotKitProvider.vue";
import { StateCapturingAgent } from "../../__tests__/utils/agents";
import { CopilotKitStyles } from "../CopilotKitStyles";

function renderPage(
  children: () => unknown[],
  providerProps: Record<string, unknown> = {},
): Promise<string> {
  const app = createSSRApp({
    render: () =>
      h(
        CopilotKitProvider as Component,
        {
          agents__unsafe_dev_only: { default: new StateCapturingAgent() },
          ...providerProps,
        },
        {
          default: children,
        },
      ),
  });
  return renderToString(app);
}

describe("CopilotKitStyles on the server", () => {
  it("puts one copy of the stylesheet in the server HTML", async () => {
    const html = await renderPage(() => [
      h(CopilotKitStyles),
      h(CopilotKitStyles),
    ]);

    const tags = html.match(/<style[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain("data-copilotkit-styles");
    // Unescaped, so selectors such as `a > b` still work.
    expect(html).toContain(`>${stylesheet}</style>`);
    expect(stylesheet).toContain(".cpk-suggestion-pill)");
  });

  it("gives each server-rendered app its own copy", async () => {
    const first = await renderPage(() => [h(CopilotKitStyles)]);
    const second = await renderPage(() => [h(CopilotKitStyles)]);

    expect(first).toContain("<style");
    expect(second).toContain("<style");
  });

  it("adds the CSP nonce to the style tag when the app passes one", async () => {
    const html = await renderPage(() => [h(CopilotKitStyles)], {
      nonce: "abc123",
    });
    const tags = html.match(/<style[^>]*>/g) ?? [];

    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('nonce="abc123"');
  });

  it("adds no style tag when the app loads styles.css itself", async () => {
    const html = await renderPage(() => [h(CopilotKitStyles)], {
      injectStyles: false,
    });

    expect(html).not.toContain("<style");
  });
});
