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

describe("globals.css sidebar Intelligence pin", () => {
  it("stays muted until hover, then fills like the header Intelligence control", () => {
    const idleBlock = globalsCss.match(
      /\.shell-docs-intelligence-entry \{[\s\S]*?\n\}/,
    )?.[0];
    expect(idleBlock).toContain("background: transparent;");
    expect(idleBlock).toContain("color: var(--text-muted);");
    expect(idleBlock).not.toContain("background: var(--accent);");

    const hoverBlock = globalsCss.match(
      /\.shell-docs-intelligence-entry:hover,\s*\.shell-docs-intelligence-entry:focus-visible \{[\s\S]*?\n\}/,
    )?.[0];
    expect(hoverBlock).toContain("background: var(--accent);");
    expect(hoverBlock).toContain("color: #fff;");
  });
});

describe("globals.css mega menu featured Intelligence", () => {
  it("leaves space under the featured Intelligence card", () => {
    expect(globalsCss).toContain(".shell-docs-mega-menu-featured-item");
    expect(globalsCss).toContain("margin-bottom: 4px;");
  });
});

describe("globals.css sidebar section folders", () => {
  it("styles collapsible section triggers separately from page links", () => {
    expect(globalsCss).toContain(".shell-docs-sidebar-section-label");
    expect(globalsCss).toContain(
      ".shell-docs-sidebar button:has(.shell-docs-sidebar-section-label)",
    );
    expect(globalsCss).toContain("flex-wrap: nowrap;");
    expect(globalsCss).toContain("svg:not([data-icon])");
  });
});
