import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const manifest = JSON.parse(
  readFileSync(join(appRoot, "package.json"), "utf8"),
) as {
  dependencies: Record<string, string>;
};
const lockfile = readFileSync(join(appRoot, "../../../pnpm-lock.yaml"), "utf8");
const importerStart = lockfile.indexOf("  examples/showcases/cloudplot:\n");
const importerEnd = lockfile.indexOf(
  "\n  examples/showcases/",
  importerStart + 1,
);
const cloudplotImporter = lockfile.slice(importerStart, importerEnd);

describe("Cloudplot AG-UI dependency compatibility", () => {
  it("pins the public AG-UI boundary expected by CopilotKit runtime", () => {
    expect(manifest.dependencies).toMatchObject({
      "@ag-ui/client": "0.0.42",
      "@ag-ui/core": "0.0.42",
      "@ag-ui/langgraph": "0.0.20",
      "@copilotkit/runtime": "1.50.0-beta.7",
    });
  });

  it("locks LangGraph to the same AG-UI client and core graph", () => {
    expect(importerStart).toBeGreaterThan(-1);
    expect(cloudplotImporter).toMatch(
      /version: 0\.0\.20\(@ag-ui\/client@0\.0\.42\)\(@ag-ui\/core@0\.0\.42\)/,
    );
  });
});
