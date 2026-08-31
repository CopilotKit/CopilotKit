/**
 * Build-time token sync (anti-drift).
 *
 * `packages/react-core/src/v2/styles/globals.css` is the canonical source of
 * truth for CopilotKit's visual design tokens. This script reads the light-mode
 * `[data-copilotkit] { ... }` token block from that file and DERIVES a small,
 * curated subset of bundled default values that the drawer's shadow-DOM CSS
 * falls back to (e.g. `var(--cpk-drawer-bg, <built default>)`).
 *
 * Running this at build time means the drawer's bundled defaults cannot drift
 * away from react-core's theme: a token change in react-core re-derives here.
 * The output is a checked-in generated file (`src/threads-drawer/generated-tokens.ts`)
 * so the package still builds and tests run without invoking the script, and so
 * drift is visible in code review as a diff to that file.
 *
 * If the canonical file or a required token is missing, this fails loudly
 * rather than silently emitting stale or empty defaults.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractLightThemeBlock,
  parseCustomProperties,
} from "../src/threads-drawer/token-extraction";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(dirname, "..");
const repoRoot = path.resolve(packageDir, "../../");

const GLOBALS_CSS = path.join(
  repoRoot,
  "packages/react-core/src/v2/styles/globals.css",
);

const OUTPUT = path.join(packageDir, "src/threads-drawer/generated-tokens.ts");

/**
 * The react-core token names (without leading `--`) that the drawer derives its
 * bundled defaults from, mapped to the drawer-local token suffix they back.
 * Keep this list minimal and structural — the drawer is a small surface.
 */
const TOKEN_MAP: ReadonlyArray<
  readonly [reactCoreVar: string, drawerToken: string]
> = [
  ["background", "bg"],
  ["foreground", "fg"],
  ["card", "surface"],
  ["card-foreground", "surface-fg"],
  ["muted", "muted"],
  ["muted-foreground", "muted-fg"],
  ["accent", "accent"],
  ["accent-foreground", "accent-fg"],
  ["primary", "primary"],
  ["primary-foreground", "primary-fg"],
  ["destructive", "danger"],
  ["border", "border"],
  ["ring", "ring"],
  ["radius", "radius"],
];

function formatObjectKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function main(): void {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const block = extractLightThemeBlock(css, GLOBALS_CSS);
  const props = parseCustomProperties(block);

  const entries: string[] = [];
  for (const [reactCoreVar, drawerToken] of TOKEN_MAP) {
    const value = props.get(reactCoreVar);
    if (value === undefined) {
      throw new Error(
        `[generate-tokens] Required token "--${reactCoreVar}" not found in canonical theme; ` +
          `react-core globals.css changed shape — update TOKEN_MAP in generate-tokens.ts.`,
      );
    }
    entries.push(
      `  ${formatObjectKey(drawerToken)}: ${JSON.stringify(value)},`,
    );
  }

  const file = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Bundled default values for the drawer's design tokens, derived at build time
 * from the canonical react-core theme (\`packages/react-core/src/v2/styles/globals.css\`)
 * by \`scripts/generate-tokens.ts\`. Run \`pnpm run gen:tokens\` to regenerate.
 *
 * The drawer's shadow-DOM CSS references these as fallbacks, e.g.
 * \`var(--cpk-drawer-bg, <built default>)\`, so consumers can override every
 * token while the built-in skin stays in sync with react-core.
 */
export const GENERATED_DRAWER_TOKEN_DEFAULTS = {
${entries.join("\n")}
} as const satisfies Record<string, string>;

export type GeneratedDrawerTokenKey =
  keyof typeof GENERATED_DRAWER_TOKEN_DEFAULTS;
`;

  writeFileSync(OUTPUT, file, "utf8");
  // eslint-disable-next-line no-console
  console.log(
    `[generate-tokens] Wrote ${TOKEN_MAP.length} derived token defaults to ${path.relative(repoRoot, OUTPUT)}`,
  );
}

// Only run the file-writing entrypoint when executed as a script (via tsx),
// NOT when imported by a test that exercises the pure helpers.
const executedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (executedDirectly) {
  main();
}
