import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundlePlayground } from "../bundler";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDir = null;
});

describe("bundlePlayground", () => {
  it("bundles a minimal entry into an IIFE exposing __copilotkit_playground", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cpk-bundler-test-"));
    fs.writeFileSync(
      path.join(tempDir, "entry.tsx"),
      [
        'import * as React from "react";',
        "export function PlaygroundEntry() {",
        "  return React.createElement('div', null, 'ok');",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const result = await bundlePlayground(path.join(tempDir, "entry.tsx"));
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/var __copilotkit_playground/);
    // Externalized: no literal 'react' import in output.
    expect(result.code).not.toMatch(/from\s+["']react["']/);
  });

  it("returns an error for a nonexistent entry", async () => {
    const result = await bundlePlayground("/definitely/does/not/exist.tsx");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
