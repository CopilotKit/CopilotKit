import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readFixture = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("README prerequisites", () => {
  it("matches the Python version required by the agent lockfile", () => {
    const readme = readFixture("./README.md");
    const lockfile = readFixture("./agent/uv.lock");
    const readmeVersion = readme.match(/Python (\d+\.\d+)\+/)?.[1];
    const lockfileVersion = lockfile.match(
      /requires-python = ">=(\d+\.\d+)"/,
    )?.[1];

    expect(readmeVersion).toBeDefined();
    expect(lockfileVersion).toBeDefined();
    expect(readmeVersion).toBe(lockfileVersion);
  });
});
