import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withTypesConditions } from "../tsdown-exports.mjs";

// Build a temp package dir whose dist/ contains the given declaration files
// and hand the callback the `ctx` tsdown's `customExports` hook would pass.
function withPackage(
  declarations: string[],
  run: (ctx: { pkg: { packageJsonPath: string } }) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cpk-tsdown-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), "{}", "utf-8");
    for (const rel of declarations) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "export {};", "utf-8");
    }
    run({ pkg: { packageJsonPath: path.join(root, "package.json") } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("withTypesConditions", () => {
  it("nests a types condition first for each import/require with a sibling declaration", () => {
    withPackage(["dist/index.d.mts", "dist/index.d.cts"], (ctx) => {
      const result = withTypesConditions(
        { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
        ctx,
      );
      expect(result).toEqual({
        ".": {
          import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      });
    });
  });

  it("leaves targets without a sibling declaration untouched", () => {
    withPackage([], (ctx) => {
      const input = {
        ".": { import: "./dist/index.mjs" },
        "./styles.css": "./dist/index.css",
        "./package.json": "./package.json",
      };
      expect(withTypesConditions(input, ctx)).toEqual(input);
    });
  });

  it("preserves a null target (blocked subpath) without crashing", () => {
    withPackage([], (ctx) => {
      expect(withTypesConditions({ "./internal": null }, ctx)).toEqual({
        "./internal": null,
      });
    });
  });

  it("maps over fallback-array targets instead of corrupting them", () => {
    withPackage(["dist/a.d.mts"], (ctx) => {
      const result = withTypesConditions(
        { ".": { import: ["./dist/a.mjs", "./dist/b.mjs"] } },
        ctx,
      );
      expect(result).toEqual({
        ".": {
          import: [
            { types: "./dist/a.d.mts", default: "./dist/a.mjs" },
            "./dist/b.mjs",
          ],
        },
      });
    });
  });

  it("throws when packageJsonPath is missing rather than silently dropping types", () => {
    expect(() =>
      withTypesConditions({ ".": { import: "./dist/index.mjs" } }, { pkg: {} }),
    ).toThrow(/packageJsonPath/);
  });
});
