/**
 * Guards the build-time token-sync (anti-drift) contract.
 *
 * The drawer's bundled default token values are DERIVED from react-core's
 * canonical theme by `scripts/generate-tokens.ts` and checked in as
 * `generated-tokens.ts`. These tests assert (a) the generated file exposes the
 * tokens the shadow-DOM CSS depends on, and (b) the checked-in values still
 * match what the canonical theme currently declares — i.e. the generated file
 * has not drifted from `react-core/.../globals.css`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { GENERATED_DRAWER_TOKEN_DEFAULTS } from "../generated-tokens";
import type { GeneratedDrawerTokenKey } from "../generated-tokens";
import {
  extractLightThemeBlock,
  parseCustomProperties,
} from "../token-extraction";

const dirname = path.dirname(fileURLToPath(import.meta.url));
// __tests__ -> drawer -> src -> web-components -> packages -> repo root
const repoRoot = path.resolve(dirname, "../../../../../");
const GLOBALS_CSS = path.join(
  repoRoot,
  "packages/react-core/src/v2/styles/globals.css",
);

/** Maps drawer token keys back to the react-core custom property they derive from. */
const DERIVATION: Record<GeneratedDrawerTokenKey, string> = {
  bg: "background",
  fg: "foreground",
  surface: "card",
  "surface-fg": "card-foreground",
  muted: "muted",
  "muted-fg": "muted-foreground",
  accent: "accent",
  "accent-fg": "accent-foreground",
  primary: "primary",
  "primary-fg": "primary-foreground",
  danger: "destructive",
  border: "border",
  ring: "ring",
  radius: "radius",
};

function readCanonicalLightTokens(): Map<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  // Route through the SAME canonical parser the build script uses, rather than a
  // local naive first-`}` scan: a reimplementation here could pass while the real
  // extractor truncates (or vice-versa), defeating the drift guarantee.
  return parseCustomProperties(extractLightThemeBlock(css, GLOBALS_CSS));
}

test("generated defaults expose every token the drawer CSS references", () => {
  const expectedKeys: GeneratedDrawerTokenKey[] = [
    "bg",
    "fg",
    "surface",
    "surface-fg",
    "muted",
    "muted-fg",
    "accent",
    "accent-fg",
    "primary",
    "primary-fg",
    "danger",
    "border",
    "ring",
    "radius",
  ];

  for (const key of expectedKeys) {
    expect(GENERATED_DRAWER_TOKEN_DEFAULTS[key]).toBeTypeOf("string");
    expect(GENERATED_DRAWER_TOKEN_DEFAULTS[key].length).toBeGreaterThan(0);
  }
});

test("checked-in generated defaults have not drifted from react-core's canonical theme", () => {
  const canonical = readCanonicalLightTokens();

  for (const [drawerKey, reactCoreVar] of Object.entries(DERIVATION)) {
    const canonicalValue = canonical.get(reactCoreVar);
    expect(
      canonicalValue,
      `react-core theme is missing --${reactCoreVar}; regenerate tokens`,
    ).toBeDefined();
    expect(
      GENERATED_DRAWER_TOKEN_DEFAULTS[drawerKey as GeneratedDrawerTokenKey],
      `drawer token "${drawerKey}" drifted from react-core --${reactCoreVar}; run "pnpm run gen:tokens"`,
    ).toBe(canonicalValue);
  }
});

// --- Fix 8: brace-balanced block extraction -------------------------------

test("extractLightThemeBlock captures the full block past a nested brace", () => {
  const css = [
    "[data-copilotkit] {",
    "  --background: #fff;",
    "  @media (min-width: 0) { --inner: 1; }",
    "  --foreground: #000;",
    "}",
    ".other { --x: 1; }",
  ].join("\n");

  const block = extractLightThemeBlock(css);

  // a naive first-`}` scan would stop at the @media close and drop --foreground
  expect(block).toContain("--background: #fff;");
  expect(block).toContain("--foreground: #000;");
  // and must NOT bleed into the sibling rule that follows the matching close
  expect(block).not.toContain("--x: 1;");
});

test("extractLightThemeBlock throws on unbalanced braces rather than truncating", () => {
  const css = "[data-copilotkit] {\n  --background: #fff;\n  { --orphan: 1;\n";

  expect(() => extractLightThemeBlock(css)).toThrow(/Unbalanced braces/);
});
