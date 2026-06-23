import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("../globals.css", import.meta.url),
  "utf8",
);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

describe("globals.css mobile docs layout", () => {
  it("collapses the Fumadocs grid to one content column on mobile", () => {
    expect(globalsCss).toContain(
      "grid-template-columns: minmax(0, 1fr) !important;",
    );
  });

  it("does not double-count the announcement banner in sub-xl docs layout offsets", () => {
    const subXlDocsLayoutRules = globalsCss.matchAll(
      /@media \((?:max-width: 767px|min-width: 768px\) and \(max-width: 1279px)\) \{\n  #nd-docs-layout \{(?<body>[\s\S]*?)\n  \}/g,
    );

    const bodies = Array.from(
      subXlDocsLayoutRules,
      (match) => match.groups?.body ?? "",
    );

    expect(bodies).toHaveLength(2);
    const [mobileBody, tabletBody] = bodies;
    for (const body of bodies) {
      expect(body).toContain("--fd-docs-row-1: 0px !important;");
      expect(body).not.toContain("--fd-banner-height");
    }
    expect(mobileBody).toContain(
      "padding-top: calc(var(--fd-nav-height) + 1rem) !important;",
    );
    expect(tabletBody).toContain(
      "padding-top: var(--fd-nav-height) !important;",
    );
  });

  it("adds extra left breathing room when the tablet sidebar is visible", () => {
    expect(globalsCss).toContain(
      "@media (min-width: 768px) and (max-width: 1279px) {\n  .docs-inner-content {\n    padding-left: 24px !important;",
    );
  });
});

describe("globals.css docs headings", () => {
  it("keeps heading anchors in block-level heading rows", () => {
    expect(globalsCss).toContain(
      ".reference-content .docs-heading {\n  display: flex;",
    );
    expect(globalsCss).not.toContain(
      ".reference-content .docs-heading {\n  display: inline-flex;",
    );
  });
});

describe("globals.css cookbook sidebar", () => {
  it("removes the empty cookbook sidebar banner and aligns the recipe list", () => {
    const normalizedGlobalsCss = normalizeWhitespace(globalsCss);

    expect(normalizedGlobalsCss).toContain(
      normalizeWhitespace(`
        .shell-docs-sidebar-cookbook > div:first-child {
          display: none !important;
        }
      `),
    );
    expect(normalizedGlobalsCss).toContain(
      normalizeWhitespace(`
        .shell-docs-sidebar-cookbook [data-radix-scroll-area-viewport] > div:first-child {
          padding-top: 0 !important;
          padding-bottom: 1.5rem !important;
        }
      `),
    );
  });
});
