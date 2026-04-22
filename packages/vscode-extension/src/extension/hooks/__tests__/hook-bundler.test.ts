import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { bundleHookSite } from "../hook-bundler";

const fx = (name: string) => path.join(__dirname, "fixtures", name);

describe("hook-bundler", () => {
  it("bundles a plain .tsx file into an IIFE string", async () => {
    const result = await bundleHookSite(fx("bundle-target.tsx"));
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/var __copilotkit_hookSite/);
    expect(result.code).toContain("Hello");
  });

  it("surfaces errors for nonexistent entrypoints", async () => {
    const result = await bundleHookSite(fx("does-not-exist.tsx"));
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
