// maplibre-gl is an optional peer. A bundler resolves every import of it at
// build time, also a dynamic one in code that never runs, so an app without
// the package fails to build when any module it imports names it. Only the
// opt-in `/generative-ui/map` entry may import it.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");

/** The source files of the package, without tests. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    }
    const isSource =
      /\.tsx?$/.test(entry.name) && !/\.test(-d)?\.tsx?$/.test(entry.name);
    return isSource ? [full] : [];
  });
}

// A runtime import: `import("maplibre-gl")`, `from "maplibre-gl"` or
// `require("maplibre-gl")`. Type-only forms (`import type`, `typeof import`)
// are erased and do not match.
const RUNTIME_IMPORT =
  /(?<!typeof\s)\bimport\(\s*["']maplibre-gl["']|^\s*import\s+(?!type\b)[^;]*?\bfrom\s+["']maplibre-gl["']|\brequire\(\s*["']maplibre-gl["']/m;

describe("maplibre-gl imports", () => {
  it("are only in the /generative-ui/map entry", () => {
    const importers = sourceFiles(SRC)
      .filter((file) => RUNTIME_IMPORT.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));
    expect(importers).toEqual(["generative-ui/map.ts"]);
  });
});
