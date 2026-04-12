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

  it('has a "types" condition in the "." export entry', () => {
    const dotExport = pkg.exports["."];
    expect(dotExport).toBeDefined();
    expect(dotExport.types).toBeDefined();
    expect(typeof dotExport.types).toBe("string");
    expect(dotExport.types).toMatch(/\.d\.c?ts$/);
  });

  it('has a "types" condition in the "./v2" export entry', () => {
    const v2Export = pkg.exports["./v2"];
    expect(v2Export).toBeDefined();
    expect(v2Export.types).toBeDefined();
    expect(typeof v2Export.types).toBe("string");
    expect(v2Export.types).toMatch(/\.d\.c?ts$/);
  });
});
