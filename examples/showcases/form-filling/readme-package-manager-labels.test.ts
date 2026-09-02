import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readme = readFileSync(new URL("./README.md", import.meta.url), "utf8");

describe("README package manager commands", () => {
  it("labels alternate commands with the package manager they use", () => {
    const commandBlocks = Array.from(
      readme.matchAll(
        /^\s*# Using (npm|yarn|pnpm|bun)(?: \([^\n]+\))?\n\s*(\S+)/gm,
      ),
      ([, label, command]) => ({ label, command }),
    );

    expect(commandBlocks.length).toBeGreaterThan(0);
    expect(commandBlocks).toEqual(
      commandBlocks.map(({ label }) => ({ label, command: label })),
    );
  });
});
