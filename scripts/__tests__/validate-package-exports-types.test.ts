import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findExportsTypeViolations,
  getPublishablePackagesWithExports,
  validateAllPackages,
} from "../validate-package-exports-types";

// Slim wrapper so each case is one readable line (package name is irrelevant
// to the checker logic).
const check = (exportsMap: unknown) =>
  findExportsTypeViolations("pkg", exportsMap);

describe("findExportsTypeViolations", () => {
  it("flags a JS export with no types condition (the #3324 bug shape)", () => {
    const violations = check({
      ".": { import: "./dist/index.mjs", require: "./dist/index.cjs" },
    });
    expect(violations.map((v) => v.subpath)).toEqual([
      ". > import",
      ". > require",
    ]);
  });

  it("accepts nested per-condition types (the fix shape)", () => {
    expect(
      check({
        ".": {
          import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      }),
    ).toEqual([]);
  });

  it("accepts a flat top-level types condition", () => {
    expect(
      check({
        ".": {
          types: "./dist/index.d.cts",
          import: "./dist/index.mjs",
          require: "./dist/index.cjs",
        },
      }),
    ).toEqual([]);
  });

  it("ignores non-JS string targets (css, package.json)", () => {
    expect(
      check({
        "./styles.css": "./dist/index.css",
        "./package.json": "./package.json",
      }),
    ).toEqual([]);
  });

  it("flags a types condition that is not a declaration file", () => {
    const violations = check({
      ".": { types: "./dist/index.js", default: "./dist/index.mjs" },
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/not a declaration file/);
  });

  it("flags a single-format bare default JS target", () => {
    expect(check({ ".": { default: "./dist/index.mjs" } })).toHaveLength(1);
  });

  it("flags only the offending subpath when a sibling is correct", () => {
    const violations = check({
      ".": {
        import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
        require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      },
      "./v2": { import: "./dist/v2/index.mjs", require: "./dist/v2/index.cjs" },
    });
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.subpath.startsWith("./v2"))).toBe(true);
  });

  it("returns nothing for packages without an exports map", () => {
    expect(check(undefined)).toEqual([]);
  });

  it("flags a `types` condition listed after a JS condition (order matters)", () => {
    // A strict resolver matches import/require before reaching a trailing
    // `types`, landing on JS with no declarations — the #3324 failure.
    const violations = check({
      ".": {
        import: "./dist/index.mjs",
        require: "./dist/index.cjs",
        types: "./dist/index.d.cts",
      },
    });
    expect(violations.map((v) => v.subpath)).toEqual([
      ". > import",
      ". > require",
    ]);
  });

  it("accepts `types` listed first ahead of JS conditions", () => {
    expect(
      check({
        ".": {
          types: "./dist/index.d.mts",
          import: "./dist/index.mjs",
        },
      }),
    ).toEqual([]);
  });

  it("flags a bare-string `exports` value (sugar for '.')", () => {
    const violations = check("./dist/index.mjs");
    expect(violations).toHaveLength(1);
    expect(violations[0].subpath).toBe(".");
  });

  it("flags conditions-only sugar with no `types`", () => {
    // No `.`/`./…` keys → whole object is the `.` target's conditions.
    const violations = check({
      import: "./dist/index.mjs",
      require: "./dist/index.cjs",
    });
    expect(violations.map((v) => v.subpath)).toEqual([
      ". > import",
      ". > require",
    ]);
  });

  it("accepts conditions-only sugar with a leading `types`", () => {
    expect(
      check({
        types: "./dist/index.d.ts",
        import: "./dist/index.mjs",
        require: "./dist/index.cjs",
      }),
    ).toEqual([]);
  });

  it("ignores runtime-only conditions TypeScript never resolves types through", () => {
    // A bare `browser`-only JS target must NOT be flagged — TypeScript resolves
    // no types through `browser`. This is the discriminating case: if
    // `isActiveCondition` wrongly treated `browser` as active, `browser` would
    // win and be flagged.
    expect(check({ ".": { browser: "./dist/index.browser.mjs" } })).toEqual([]);
    // ...and a runtime-only sibling alongside typed import/require is fine too.
    expect(
      check({
        ".": {
          import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
          browser: "./dist/index.browser.mjs",
        },
      }),
    ).toEqual([]);
  });

  it("flags an object-valued `types` per resolution mode", () => {
    // `types` covers only import (its leaf is JS, flagged); require falls
    // through the partial `types` object to the untyped `default`.
    const violations = check({
      ".": {
        types: { import: "./dist/index.mjs" },
        default: "./dist/index.mjs",
      },
    });
    expect(violations.map((v) => v.subpath)).toEqual([
      ". > types > import",
      ". > default",
    ]);
  });

  it("accepts a well-formed object-valued `types` covering both modes", () => {
    expect(
      check({
        ".": {
          types: {
            import: "./dist/index.d.mts",
            require: "./dist/index.d.cts",
          },
        },
      }),
    ).toEqual([]);
  });

  it("flags a partial object `types` that leaves a mode falling through to JS", () => {
    // import-only `types` → require falls through to the bare-JS `require`.
    expect(
      check({
        ".": {
          types: { import: "./dist/index.d.mts" },
          require: "./dist/index.cjs",
        },
      }).map((v) => v.subpath),
    ).toEqual([". > require"]);
    // require-only `types` → import falls through to the bare-JS `import`.
    expect(
      check({
        ".": {
          types: { require: "./dist/index.d.cts" },
          import: "./dist/index.mjs",
        },
      }).map((v) => v.subpath),
    ).toEqual([". > import"]);
  });

  it("treats a `null` target (blocked subpath) as no violation", () => {
    expect(check({ "./internal": null })).toEqual([]);
  });

  it("walks fallback-array targets", () => {
    const violations = check({ ".": ["./dist/a.mjs", "./dist/b.mjs"] });
    expect(violations.map((v) => v.subpath)).toEqual([".[0]", ".[1]"]);
  });

  it("flags a top-level fallback array (sugar for '.')", () => {
    expect(check(["./dist/a.mjs"]).map((v) => v.subpath)).toEqual([".[0]"]);
  });

  it("does not flag trailing default/node shadowed by typed import + require", () => {
    // import-mode resolves `import`, require-mode resolves `require`; the
    // trailing `default`/`node` are never reached for types, so neither is
    // flagged.
    expect(
      check({
        ".": {
          import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
          node: "./dist/index.mjs",
          default: "./dist/index.mjs",
        },
      }),
    ).toEqual([]);
  });
});

describe("all publishable packages (regression guard for #3324)", () => {
  it("discovers the publishable packages that declare exports", () => {
    const names = getPublishablePackagesWithExports().map((p) => p.name);
    // Sanity check the scanner actually found the workspace packages.
    expect(names).toContain("@copilotkit/react-core");
    expect(names.length).toBeGreaterThan(5);
  });

  it("declare a types condition for every JS export", () => {
    const violations = validateAllPackages();
    // Show the offending package + subpath in the failure message.
    expect(
      violations,
      violations
        .map((v) => `${v.package} ${v.subpath}: ${v.reason}`)
        .join("\n"),
    ).toEqual([]);
  });
});

describe("getPublishablePackagesWithExports (fixture-based discovery)", () => {
  function writePackage(root: string, dir: string, pkg: object): void {
    const pkgDir = path.join(root, dir);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify(pkg),
      "utf-8",
    );
  }

  function withFixtureRoot(run: (root: string) => void): void {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cpk-exports-"));
    try {
      run(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  it("includes only non-private packages that declare exports", () => {
    withFixtureRoot((root) => {
      writePackage(root, "published", {
        name: "@x/published",
        exports: { ".": "./index.mjs" },
      });
      writePackage(root, "private-pkg", {
        name: "@x/private",
        private: true,
        exports: { ".": "./index.mjs" },
      });
      writePackage(root, "no-exports", { name: "@x/no-exports" });
      // A directory without a package.json is skipped, not an error.
      fs.mkdirSync(path.join(root, "not-a-package"), { recursive: true });

      const names = getPublishablePackagesWithExports(root).map((p) => p.name);
      expect(names).toEqual(["@x/published"]);
    });
  });

  it("throws with the file path on a malformed package.json", () => {
    withFixtureRoot((root) => {
      const pkgDir = path.join(root, "broken");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, "package.json"),
        "{ not json",
        "utf-8",
      );
      expect(() => getPublishablePackagesWithExports(root)).toThrow(
        /broken[\\/]package\.json/,
      );
    });
  });
});
