import { describe, it, expect } from "vitest";
import { bundleCatalog } from "../bundler";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("bundleCatalog", () => {
  it("bundles a simple TypeScript file to IIFE string", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-bundler-"));
    const entryPath = path.join(tmpDir, "test-catalog.ts");
    fs.writeFileSync(
      entryPath,
      `
      export const catalog = { name: "test" };
      export default catalog;
      `,
    );

    const result = await bundleCatalog(entryPath);

    expect(result.success).toBe(true);
    expect(result.code).toContain("test");
    expect(result.code).toContain("__copilotkit_catalog");
    expect(result.error).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("returns error for file with syntax errors", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-bundler-"));
    const entryPath = path.join(tmpDir, "bad.ts");
    fs.writeFileSync(entryPath, `export const x = {{{;`);

    const result = await bundleCatalog(entryPath);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("externalizes react and @copilotkit packages", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ck-bundler-"));
    const entryPath = path.join(tmpDir, "imports.ts");
    fs.writeFileSync(
      entryPath,
      `
      import React from "react";
      import { createCatalog } from "@copilotkit/a2ui-renderer";
      export default { React, createCatalog };
      `,
    );

    const result = await bundleCatalog(entryPath);

    expect(result.success).toBe(true);
    // Externalized imports should reference globals, not bare specifiers
    expect(result.code).toContain("__copilotkit_deps");
    expect(result.code).not.toContain('from "react"');
    expect(result.code).not.toContain('from "@copilotkit/a2ui-renderer"');

    fs.rmSync(tmpDir, { recursive: true });
  });
});
