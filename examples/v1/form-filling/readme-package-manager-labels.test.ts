import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");

describe("README package manager commands", () => {
  it("documents pnpm as the only supported package manager", () => {
    expect(readme).toContain("- pnpm");
    expect(readme).not.toMatch(/\b(?:npm|yarn) (?:install|run|dev)\b/);
    expect(readme).not.toContain("Using other package managers");
  });
});
