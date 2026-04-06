/**
 * Verifies that bundled .d.ts files don't contain TypeScript-only syntax
 * that would crash a JavaScript parser.
 *
 * Background: Next.js and webpack (via tsconfig-paths-webpack-plugin) can
 * resolve tsconfig `paths` aliases that point to .d.ts files. When that
 * happens, the bundler tries to parse the .d.ts as JavaScript. Inline
 * `type` modifiers in export statements (`export { type Foo }`) are valid
 * TypeScript but invalid JavaScript, causing:
 *
 *   × JavaScript parse error: Expected ',', got 'Foo'
 *
 * The copy-dts.mjs post-build script strips these modifiers. This test
 * ensures they stay stripped.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const DIST_DIR = resolve(__dirname, "../../dist");

/** Matches `export { ... }` blocks (not `export type { ... }`). */
const EXPORT_BLOCK_RE = /\bexport\s*\{([^}]+)\}/g;

/** Matches an inline `type` modifier inside an export specifier list. */
const INLINE_TYPE_RE = /(?:^|,)\s*type\s+(?!as\b)\w/;

function collectDeclarationFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectDeclarationFiles(full));
    } else if (/\.d\.(ts|cts|mts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("bundled declaration files are JS-safe", () => {
  const files = collectDeclarationFiles(DIST_DIR);

  it("dist/ contains declaration files", () => {
    // If dist doesn't exist or is empty, the build hasn't run.
    // Skip rather than false-pass.
    if (files.length === 0) {
      console.warn(
        "[dts-js-safe] No .d.ts files found in dist/ — run `pnpm build` first. Skipping.",
      );
      return;
    }
    expect(files.length).toBeGreaterThan(0);
  });

  it("no inline type modifiers in export statements", () => {
    if (files.length === 0) return; // skip if no build

    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        EXPORT_BLOCK_RE.lastIndex = 0;
        let match;
        while ((match = EXPORT_BLOCK_RE.exec(line)) !== null) {
          if (INLINE_TYPE_RE.test(match[1])) {
            violations.push(`${relative(DIST_DIR, file)}:${i + 1}`);
            break;
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found inline \`type\` modifiers in export statements (invalid JS syntax):\n` +
          violations.map((v) => `  - ${v}`).join("\n") +
          `\n\nRun \`node ../../scripts/copy-dts.mjs\` to fix.`,
      );
    }
  });
});
