import { describe, expect, it } from "vitest";

import { renderAnnouncementDocument } from "./document.js";

function renderIntoContainer(markdown: string, baseUrl?: string) {
  const rendered = renderAnnouncementDocument(markdown, baseUrl);
  const container = document.createElement("div");
  container.innerHTML = rendered;
  return { container, rendered };
}

describe("renderAnnouncementDocument", () => {
  it("escapes raw HTML and fenced code while preserving the copy value", () => {
    const rawTag = ["<", "script", ">"].join("");
    const closingTag = ["</", "script", ">"].join("");
    const code = `${rawTag}alert('safe & exact')${closingTag}`;
    const { container, rendered } = renderIntoContainer(
      `${rawTag}raw${closingTag}\n\n\`\`\`html:onload\n${code}\n\`\`\``,
    );

    expect(rendered).not.toContain(rawTag);
    expect(rendered).toContain("&lt;script&gt;");
    expect(container.querySelector("script")).toBeNull();
    expect(
      container
        .querySelector("cpk-inspector-copy-button")
        ?.getAttribute("value"),
    ).toBe(code);
    expect(container.querySelector("code")?.className).toBe(
      "language-htmlonload",
    );
  });

  it.each([
    ["https://example.com/docs", "https://example.com/docs?ref=cpk-inspector"],
    ["http://example.com/docs", "http://example.com/docs?ref=cpk-inspector"],
    ["mailto:help@example.com", "mailto:help@example.com?ref=cpk-inspector"],
    ["/docs", "/docs?ref=cpk-inspector"],
    ["../docs", "https://host.test/docs?ref=cpk-inspector"],
    [
      "https://example.com/docs?ref=existing",
      "https://example.com/docs?ref=existing",
    ],
  ])("keeps the safe link %s", (href, expected) => {
    const { container } = renderIntoContainer(
      `[Docs](${href})`,
      "https://host.test/app",
    );
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe(expected);
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener");
  });

  it("neutralizes unsafe link protocols", () => {
    const { container } = renderIntoContainer("[Bad](javascript:alert(1))");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("#");
  });
});
