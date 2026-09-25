import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("showcase harness Dockerfile", () => {
  it("copies root pnpm patches before the frozen install", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "../Dockerfile"),
      "utf8",
    );
    const copyPatches = source.indexOf("COPY patches ./patches");
    const frozenInstall = source.indexOf("pnpm install --frozen-lockfile");

    expect(copyPatches).toBeGreaterThan(-1);
    expect(copyPatches).toBeLessThan(frozenInstall);
  });
});
