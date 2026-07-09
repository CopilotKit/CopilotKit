import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(
  new URL("../globals.css", import.meta.url),
  "utf8",
);
const brandCssUrl = new URL("../../styles/brand.css", import.meta.url);
const brandCss = existsSync(brandCssUrl)
  ? readFileSync(brandCssUrl, "utf8")
  : "";
const layoutSource = readFileSync(
  new URL("../layout.tsx", import.meta.url),
  "utf8",
);
const fontsSourceUrl = new URL("../fonts.ts", import.meta.url);
const fontsSource = existsSync(fontsSourceUrl)
  ? readFileSync(fontsSourceUrl, "utf8")
  : "";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cssBlock(source: string, selector: string): string {
  const blockStart = source.indexOf(`${selector} {`);
  if (blockStart === -1) return "";

  const openBrace = source.indexOf("{", blockStart);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openBrace + 1, index);
  }

  return "";
}

function expectToken(block: string, name: string, value: string): void {
  expect(normalizeWhitespace(block)).toContain(`${name}: ${value};`);
}

function readHexToken(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "i"));

  expect(match, `${name} must be a six-digit hex color`).not.toBeNull();
  return match?.[1] ?? "#000000";
}

function relativeLuminance(hexColor: string): number {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid hex color: ${hexColor}`);
  }

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function expectTextContrast(
  block: string,
  foregroundToken: string,
  backgroundTokens: string[],
): void {
  const foreground = readHexToken(block, foregroundToken);

  for (const backgroundToken of backgroundTokens) {
    const background = readHexToken(block, backgroundToken);
    expect(
      contrastRatio(foreground, background),
      `${foregroundToken} on ${backgroundToken}`,
    ).toBeGreaterThanOrEqual(4.5);
  }
}

describe("shell-docs brand foundation", () => {
  it("owns theme tokens in the focused brand stylesheet", () => {
    expect(globalsCss).toContain('@import "../styles/brand.css";');
    expect(brandCss).not.toBe("");
    expect(globalsCss).not.toMatch(/--background\s*:/);
    expect(globalsCss).not.toMatch(/--font-docs-prose\s*:/);
  });

  it("defines the accessible light docs palette", () => {
    const light = cssBlock(brandCss, ":root");

    expectToken(light, "--docs-color-canvas", "#ededf5");
    expectToken(light, "--docs-color-surface", "#ffffff");
    expectToken(light, "--docs-color-elevated", "#f7f7f9");
    expectToken(light, "--docs-color-hover", "#f0f0f4");
    expectToken(light, "--docs-color-text-primary", "#010507");
    expectToken(light, "--docs-color-text-secondary", "#57575b");
    expectToken(light, "--docs-color-text-muted", "#57575b");
    expectToken(light, "--docs-color-border", "#dbdbe5");
    expectToken(light, "--docs-color-lilac-ambient", "#bec2ff");
    expectToken(light, "--docs-color-lilac-accent", "#5b62d4");
    expectToken(light, "--docs-color-accent-text", "#565dcd");
    expectToken(light, "--docs-color-mint-ambient", "#85ecce");
    expectToken(light, "--docs-color-mint-accent", "#189370");
    expectToken(light, "--docs-color-orange-support", "#ffac4d");
    expectToken(light, "--docs-color-yellow-support", "#fff388");
    expectToken(light, "--docs-color-red-brand", "#fa5f67");
    expectToken(light, "--docs-color-destructive-text", "#c7313e");
  });

  it("defines the accessible dark docs palette", () => {
    const dark = cssBlock(brandCss, ".dark");

    expectToken(dark, "--docs-color-canvas", "#010507");
    expectToken(dark, "--docs-color-surface", "#15151a");
    expectToken(dark, "--docs-color-elevated", "#202026");
    expectToken(dark, "--docs-color-hover", "#2b2b2b");
    expectToken(dark, "--docs-color-text-primary", "#fafafc");
    expectToken(dark, "--docs-color-text-secondary", "#afafb7");
    expectToken(dark, "--docs-color-text-muted", "#afafb7");
    expectToken(dark, "--docs-color-border", "rgba(255, 255, 255, 0.1)");
    expectToken(dark, "--docs-color-lilac-accent", "#bec2ff");
    expectToken(dark, "--docs-color-accent-text", "#bec2ff");
    expectToken(dark, "--docs-color-mint-accent", "#85ecce");
    expectToken(dark, "--docs-color-destructive-text", "#fa5f67");
  });

  it("keeps semantic text colors at WCAG AA contrast on their surfaces", () => {
    const light = cssBlock(brandCss, ":root");
    const dark = cssBlock(brandCss, ".dark");
    const docsSurfaces = [
      "--docs-color-canvas",
      "--docs-color-surface",
      "--docs-color-elevated",
      "--docs-color-hover",
    ];

    expectTextContrast(light, "--docs-color-accent-text", docsSurfaces);
    expectTextContrast(light, "--docs-color-destructive-text", [
      "--docs-color-canvas",
      "--docs-color-surface",
    ]);
    expectTextContrast(dark, "--docs-color-accent-text", docsSurfaces);
    expectTextContrast(dark, "--docs-color-destructive-text", docsSurfaces);
  });

  it("preserves Fumadocs and shell aliases through docs semantic tokens", () => {
    const light = cssBlock(brandCss, ":root");

    expectToken(light, "--background", "var(--docs-color-canvas)");
    expectToken(light, "--foreground", "var(--docs-color-text-primary)");
    expectToken(light, "--bg", "var(--background)");
    expectToken(light, "--bg-surface", "var(--card)");
    expectToken(light, "--text", "var(--foreground)");
    expectToken(light, "--primary", "var(--docs-color-lilac-accent)");
    expectToken(light, "--accent", "var(--docs-color-accent-text)");
    expectToken(light, "--destructive", "var(--docs-color-destructive-text)");
    expect(brandCss).toContain("@theme inline");
    expect(brandCss).toContain("--color-fd-background: var(--bg);");
  });

  it("defines distinct shape, motion, reduced-motion, and stacking contracts", () => {
    const light = cssBlock(brandCss, ":root");
    const reducedMotion = cssBlock(
      brandCss,
      "@media (prefers-reduced-motion: reduce)",
    );

    expectToken(light, "--docs-radius-control", "8px");
    expectToken(light, "--docs-radius-icon", "8px");
    expectToken(light, "--docs-radius-surface", "12px");
    expectToken(light, "--docs-radius-panel", "16px");
    expectToken(light, "--docs-radius-pill", "9999px");
    expectToken(light, "--motion-duration-fast", "120ms");
    expectToken(light, "--motion-duration-standard", "180ms");
    expectToken(light, "--motion-duration-slow", "260ms");
    expectToken(light, "--z-dropdown", "20");
    expectToken(light, "--z-sticky", "30");
    expectToken(light, "--z-backdrop", "40");
    expectToken(light, "--z-modal", "50");
    expectToken(light, "--z-toast", "60");
    expectToken(light, "--z-tooltip", "70");
    expect(reducedMotion).toContain("--motion-duration-fast: 0.01ms;");
    expect(brandCss).toContain("--radius-sm: var(--docs-radius-control);");
    expect(brandCss).toContain("--radius-xl: var(--docs-radius-panel);");
  });

  it("loads both official variable fonts locally and applies their variables", () => {
    expect(fontsSource).toContain('import localFont from "next/font/local";');
    expect(fontsSource).toContain(
      'src: "./fonts/PlusJakartaSans-VariableFont_wght.woff2"',
    );
    expect(fontsSource).toContain(
      'src: "./fonts/SplineSansMono-VariableFont_wght.woff2"',
    );
    expect(fontsSource).toContain('variable: "--font-prose"');
    expect(fontsSource).toContain('variable: "--font-code"');
    expect(fontsSource.match(/display: "swap"/g)).toHaveLength(2);
    expect(layoutSource).not.toContain("next/font/google");
    expect(layoutSource).toContain(
      'import { plusJakartaSans, splineSansMono } from "./fonts";',
    );
    expect(normalizeWhitespace(layoutSource)).toContain(
      "className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}",
    );
    expect(
      existsSync(
        new URL(
          "../fonts/PlusJakartaSans-VariableFont_wght.woff2",
          import.meta.url,
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        new URL(
          "../fonts/SplineSansMono-VariableFont_wght.woff2",
          import.meta.url,
        ),
      ),
    ).toBe(true);
  });
});

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
