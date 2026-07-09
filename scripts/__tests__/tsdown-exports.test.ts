import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { withTypesConditions } from "../tsdown-exports.mjs";
import { findExportsTypeViolations } from "../validate-package-exports-types";

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

// Capture `console.warn` output for the duration of `run`, then restore it.
function withWarnSpy(run: (warnings: string[]) => void): void {
  const warnings: string[] = [];
  const spy = vi
    .spyOn(console, "warn")
    .mockImplementation((message) => warnings.push(String(message)));
  try {
    run(warnings);
  } finally {
    spy.mockRestore();
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
      // `types` must be emitted FIRST — that is the whole point (attw flags a
      // types-last condition). toEqual is key-order-insensitive, so assert
      // order via serialization, which preserves insertion order.
      const json = JSON.stringify(result);
      expect(json).toContain('"import":{"types":');
      expect(json).toContain('"require":{"types":');
    });
  });

  it("is idempotent — re-applying does not re-nest the default target", () => {
    withPackage(["dist/index.d.mts", "dist/index.d.cts"], (ctx) => {
      const once = withTypesConditions(
        { ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" } },
        ctx,
      );
      expect(withTypesConditions(once, ctx)).toEqual(once);
    });
  });

  it("normalizes a hand-authored types-last entry (idempotency keys on first key)", () => {
    withPackage(["dist/index.d.mts", "dist/index.d.cts"], (ctx) => {
      const result = withTypesConditions(
        {
          ".": {
            import: "./dist/index.mjs",
            require: "./dist/index.cjs",
            types: "./dist/index.d.cts",
          },
        },
        ctx,
      );
      // A leading `types` means "already processed" and is skipped, but a
      // trailing `types` must NOT short-circuit — import/require still get
      // nested types conditions (leaving the shadowed top-level `types` as-is).
      expect(result).toEqual({
        ".": {
          import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
          types: "./dist/index.d.cts",
        },
      });
    });
  });

  it("leaves non-JS targets (css, package.json) untouched, silently", () => {
    withWarnSpy((warnings) => {
      withPackage([], (ctx) => {
        const input = {
          "./styles.css": "./dist/index.css",
          "./package.json": "./package.json",
        };
        expect(withTypesConditions(input, ctx)).toEqual(input);
      });
      expect(warnings).toEqual([]);
    });
  });

  it("warns and leaves a JS target with no adjacent declaration untouched", () => {
    withWarnSpy((warnings) => {
      withPackage([], (ctx) => {
        const input = { ".": { import: "./dist/index.mjs" } };
        expect(withTypesConditions(input, ctx)).toEqual(input);
      });
      expect(
        warnings.some((w) => w.includes("has no adjacent declaration")),
      ).toBe(true);
    });
  });

  it("normalizes a types-first PARTIAL object so the uncovered mode gets typed", () => {
    // `types` (import-only) covers import; require has no types, so the helper
    // must still add one to the bare `require` rather than skipping the entry.
    withPackage(["dist/index.d.mts", "dist/index.d.cts"], (ctx) => {
      const result = withTypesConditions(
        {
          ".": {
            types: { import: "./dist/index.d.mts" },
            require: "./dist/index.cjs",
          },
        },
        ctx,
      );
      expect(result).toEqual({
        ".": {
          types: { import: "./dist/index.d.mts" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      });
    });
  });

  it("produces output the validator accepts (round-trip)", () => {
    withPackage(
      [
        "dist/index.d.mts",
        "dist/index.d.cts",
        "dist/v2/index.d.mts",
        "dist/v2/index.d.cts",
      ],
      (ctx) => {
        const result = withTypesConditions(
          {
            ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" },
            "./v2": {
              import: "./dist/v2/index.mjs",
              require: "./dist/v2/index.cjs",
            },
            "./package.json": "./package.json",
          },
          ctx,
        );
        expect(findExportsTypeViolations("pkg", result)).toEqual([]);
      },
    );
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
      // The typed array element must also keep `types` first.
      expect(JSON.stringify(result)).toContain('[{"types":');
    });
  });

  it("throws when packageJsonPath is missing rather than silently dropping types", () => {
    expect(() =>
      withTypesConditions({ ".": { import: "./dist/index.mjs" } }, { pkg: {} }),
    ).toThrow(/packageJsonPath/);
  });
});
