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

  it("places the primary docs tabs beside the mobile drawer close control", () => {
    const normalizedGlobalsCss = normalizeWhitespace(globalsCss);

    expect(normalizedGlobalsCss).toMatch(
      /\.shell-docs-mobile-sidebar-tabs \{ display: flex; position: absolute; top: 1rem; right: 3\.5rem; left: 1rem;/,
    );
    expect(normalizedGlobalsCss).toContain(
      "#nd-sidebar-mobile > div:first-child { position: relative; }",
    );
    expect(normalizedGlobalsCss).toMatch(
      /\.shell-docs-mobile-sidebar-tabs \.shell-docs-primary-tab \{ height: 1\.75rem;[\s\S]*?gap: 0\.1875rem;[\s\S]*?padding: 0 0\.25rem;[\s\S]*?font-size: 0\.6875rem;/,
    );
    expect(normalizedGlobalsCss).toContain(
      ".shell-docs-mobile-sidebar-tabs .shell-docs-primary-tab svg { width: 0.8125rem; height: 0.8125rem; }",
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

describe("globals.css docs media breakouts", () => {
  it("keeps standard tables and code blocks aligned to the prose measure", () => {
    expect(globalsCss).toContain(
      ".docs-article-content .reference-content > img",
    );
    expect(globalsCss).not.toMatch(
      /\.reference-content\s*>\s*:is\([^)]*(?:table|figure\.shiki)/,
    );
  });
});

describe("globals.css docs page actions", () => {
  it("styles the split control as one purple primary action", () => {
    const normalizedGlobalsCss = normalizeWhitespace(globalsCss);

    expect(normalizedGlobalsCss).toContain(
      normalizeWhitespace(`
        .docs-page-actions-primary,
        .docs-page-actions-trigger {
          cursor: pointer;
          border-color: var(--accent) !important;
          background-color: var(--accent) !important;
          color: var(--primary-foreground) !important;
        }
      `),
    );
    expect(normalizedGlobalsCss).toContain(
      normalizeWhitespace(`
        .docs-page-actions-primary:hover,
        .docs-page-actions-trigger:hover,
        .docs-page-actions-trigger[data-state="open"] {
          border-color: var(--accent) !important;
          background-color: var(--docs-page-actions-hover) !important;
        }
      `),
    );
    expect(normalizedGlobalsCss).toContain(
      normalizeWhitespace(`
        --docs-page-actions-hover: color-mix(
          in oklch,
          var(--accent) 68%,
          black
        );
      `),
    );
  });

  it("gives the primary action a reduced-motion-safe shimmer", () => {
    expect(globalsCss).toContain("@keyframes docs-page-actions-shimmer");
    expect(globalsCss).toContain(
      "animation: docs-page-actions-shimmer 4.5s ease-in-out infinite;",
    );
    expect(globalsCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(globalsCss).toContain("animation: none;");
  });

  it("keeps the mobile shimmer fitted to the split control", () => {
    expect(globalsCss).toContain(
      ".docs-page-tools {\n    max-width: 100%;\n    overflow-x: auto;",
    );
    expect(globalsCss).not.toContain(
      ".docs-page-tools {\n    width: 100%;\n    overflow-x: auto;",
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

describe("globals.css sidebar section labels", () => {
  it("styles static section labels with the docs accent", () => {
    expect(globalsCss).toMatch(
      /\.shell-docs-sidebar p\.inline-flex\.gap-2\s*\{[\s\S]*?color:\s*var\(--accent\)\s*!important;[\s\S]*?font-family:\s*inherit\s*!important;[\s\S]*?font-size:\s*0\.8125rem\s*!important;/,
    );
    expect(globalsCss).not.toContain("shell-docs-sidebar-section-label");
  });

  it("keeps static section labels purple in the mobile drawer", () => {
    expect(globalsCss).toContain(
      "#nd-sidebar-mobile p.inline-flex.gap-2 {\n  color: var(--accent) !important;",
    );
  });

  it("fades sidebar content only at overflowing edges", () => {
    expect(globalsCss).toContain("[data-shell-docs-scroll-shadow-top]:not(");
    expect(globalsCss).toContain(
      "[data-shell-docs-scroll-shadow-bottom]:not(",
    );
    expect(globalsCss).toContain(
      "[data-shell-docs-scroll-shadow-top][data-shell-docs-scroll-shadow-bottom]",
    );
    expect(globalsCss).not.toContain("data-shell-docs-scroll-frame]::before");
  });
});
