import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, it, expect } from "vitest";

// Apps reach channels-core through `@copilotkit/runtime`, and app bundlers
// follow every literal import, `import()` included. If a module behind the
// main entry points reaches Takumi, every app bundles its native `.node`
// binary, or fails to resolve the optional peer. Only the opt-in `./takumi`
// entry may import it.

const pkgDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PEER = /^(takumi-js|react)(\/|$)|^@takumi-rs\//;
const exportsMap = JSON.parse(
  fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"),
).exports as Record<string, { import: string }>;

/** Bare specifiers imported by every module reachable from `entry`. */
function bareImports(entry: string): string[] {
  const seen = new Set<string>();
  const bare: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    // `true, true`: also collect `import()` and `require()`.
    for (const { fileName } of ts.preProcessFile(text, true, true)
      .importedFiles) {
      if (fileName.startsWith(".")) {
        visit(path.resolve(path.dirname(file), fileName));
      } else {
        bare.push(fileName);
      }
    }
  };
  visit(path.join(pkgDir, entry));
  return bare;
}

// Reads the BUILT package: `nx test` depends on `build`, so dist is current.
describe("Takumi stays behind the opt-in entry point", () => {
  it.each(Object.entries(exportsMap).filter(([key]) => key !== "./takumi"))(
    "%s does not reach takumi-js or react",
    (_key, { import: entry }) => {
      expect(bareImports(entry).filter((s) => PEER.test(s))).toEqual([]);
    },
  );

  it("./takumi imports takumi-js", () => {
    expect(bareImports(exportsMap["./takumi"]!.import)).toContain("takumi-js");
  });
});
