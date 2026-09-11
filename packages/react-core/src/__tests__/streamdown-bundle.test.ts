import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("streamdown dependency graph", () => {
  it("does not resolve the incompatible Langium parser release", () => {
    const lockfile = readFileSync(
      resolve(process.cwd(), "../../pnpm-lock.yaml"),
      "utf8",
    );

    expect(lockfile).not.toContain("'@mermaid-js/parser@0.6.3':");
    expect(lockfile).not.toContain("mermaid@11.12.2:");
  });
});
