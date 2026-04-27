import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("react-core package.json exports", () => {
  const pkgPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  it('has nested "types" conditions in the "." export entry', () => {
    const dotExport = pkg.exports["."];
    expect(dotExport).toBeDefined();
    expect(dotExport.import).toBeDefined();
    expect(dotExport.import.types).toMatch(/\.d\.mts$/);
    expect(dotExport.import.default).toMatch(/\.mjs$/);
    expect(dotExport.require).toBeDefined();
    expect(dotExport.require.types).toMatch(/\.d\.cts$/);
    expect(dotExport.require.default).toMatch(/\.cjs$/);
  });

  it('has nested "types" conditions in the "./v2" export entry', () => {
    const v2Export = pkg.exports["./v2"];
    expect(v2Export).toBeDefined();
    expect(v2Export.import).toBeDefined();
    expect(v2Export.import.types).toMatch(/\.d\.mts$/);
    expect(v2Export.import.default).toMatch(/\.mjs$/);
    expect(v2Export.require).toBeDefined();
    expect(v2Export.require.types).toMatch(/\.d\.cts$/);
    expect(v2Export.require.default).toMatch(/\.cjs$/);
  });
});
