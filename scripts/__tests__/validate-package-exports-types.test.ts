import { describe, it, expect } from "vitest";
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
