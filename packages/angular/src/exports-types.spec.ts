import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

describe("angular package.json exports", () => {
  it('has a "types" condition in the "." export entry', () => {
    const pkgPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const dotExport = pkg.exports["."];

    expect(dotExport).toBeDefined();
    expect(dotExport.types).toBeDefined();
    expect(typeof dotExport.types).toBe("string");
    expect(dotExport.types).toMatch(/\.d\.ts$/);
  });
});
