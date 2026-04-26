import { describe, expect, it } from "vitest";
import path from "node:path";
import { findPackageRoot } from "./package-root.js";

/**
 * `findPackageRoot` is the source/dist-symmetric resolver used by
 * `scripts/d6-capture-references.ts` (and any future CLI script that
 * needs to anchor paths relative to the package root regardless of
 * whether it's running uncompiled or post-`tsc`).
 *
 * The bug it fixes: `path.dirname(import.meta.url) + ".."` from a
 * source file `<pkg>/scripts/foo.ts` resolves to `<pkg>` (correct),
 * but the same expression from the compiled `<pkg>/dist/scripts/foo.js`
 * resolves to `<pkg>/dist` (wrong). All "package root" tests below use
 * an injected `exists` predicate so we can simulate both layouts
 * without touching the filesystem.
 */

describe("findPackageRoot", () => {
  it("resolves to the package root from a source-tree subdirectory", () => {
    const pkgRoot = "/abs/showcase/ops";
    const startDir = path.join(pkgRoot, "scripts");
    const fakeFs = new Set<string>([path.join(pkgRoot, "package.json")]);
    const exists = (p: string): boolean => fakeFs.has(p);
    expect(findPackageRoot(startDir, exists)).toBe(pkgRoot);
  });

  it("resolves to the package root from the compiled dist subdirectory", () => {
    // After tsc, the script lives at <pkg>/dist/scripts/foo.js. The
    // walker must skip over `<pkg>/dist` (which has no package.json)
    // and land on `<pkg>` so the default outputDir doesn't drift to
    // `<pkg>/dist/fixtures/d6-reference`.
    const pkgRoot = "/abs/showcase/ops";
    const startDir = path.join(pkgRoot, "dist", "scripts");
    const fakeFs = new Set<string>([path.join(pkgRoot, "package.json")]);
    const exists = (p: string): boolean => fakeFs.has(p);
    expect(findPackageRoot(startDir, exists)).toBe(pkgRoot);
  });

  it("returns startDir itself when it directly contains package.json", () => {
    const pkgRoot = "/abs/showcase/ops";
    const fakeFs = new Set<string>([path.join(pkgRoot, "package.json")]);
    const exists = (p: string): boolean => fakeFs.has(p);
    expect(findPackageRoot(pkgRoot, exists)).toBe(pkgRoot);
  });

  it("throws when no package.json is found before the filesystem root", () => {
    const exists = (): boolean => false;
    expect(() => findPackageRoot("/abs/showcase/ops/scripts", exists)).toThrow(
      /no package\.json/,
    );
  });

  it("stops at the deepest enclosing package.json, not the workspace root", () => {
    // Both showcase-ops and the monorepo root have a package.json; the
    // walker must stop at the FIRST one it finds (closest to startDir).
    const pkgRoot = "/abs/repo/showcase/ops";
    const startDir = path.join(pkgRoot, "scripts");
    const fakeFs = new Set<string>([
      path.join(pkgRoot, "package.json"),
      "/abs/repo/package.json",
    ]);
    const exists = (p: string): boolean => fakeFs.has(p);
    expect(findPackageRoot(startDir, exists)).toBe(pkgRoot);
  });
});
