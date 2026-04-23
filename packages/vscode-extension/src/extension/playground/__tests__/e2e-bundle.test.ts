import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanPlayground } from "../scanner";
import { writePlaygroundSources } from "../codegen/entry-codegen";
import { bundlePlayground } from "../bundler";

const workspace = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "test-workspace",
  "playground",
);

let outDir: string | null = null;

afterEach(() => {
  if (outDir && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  outDir = null;
});

describe("playground end-to-end bundle", () => {
  it("scans → codegens → bundles the test-workspace playground", async () => {
    const scan = scanPlayground(workspace);
    const sources = writePlaygroundSources(scan);
    expect(sources).not.toBeNull();
    outDir = sources!.outDir;

    const bundle = await bundlePlayground(sources!.entryPath);
    expect(bundle.success).toBe(true);
    expect(bundle.code).toBeTruthy();
    expect(bundle.code!).toMatch(/var __copilotkit_playground/);

    // The IIFE must reference every user component's name (as an imported
    // identifier). This is the cheapest way to assert the aggregator wired
    // up all of them.
    for (const c of scan.componentsWithHooks) {
      if (c.exportName == null) continue; // skipped components
      expect(bundle.code!).toContain(c.componentName);
    }

    // The provider chain must reference both ancestor tag names.
    for (const a of scan.ancestorChain ?? []) {
      expect(bundle.code!).toContain(a.tagName);
    }
  }, 60_000);
});
