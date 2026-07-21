import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SCRIPTS_DIR = resolve(import.meta.dirname, "..");
const RUNNER = resolve(SCRIPTS_DIR, "run-packed-angular-smoke.ts");

describe("packed Angular smoke loader", () => {
  it("loads the root release helper across the ESM package boundary", () => {
    const result = spawnSync("pnpm", ["exec", "tsx", RUNNER], {
      cwd: SCRIPTS_DIR,
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain(
      "usage: run-packed-angular-smoke.ts <consumer-directory>",
    );
    expect(output).not.toContain("does not provide an export named");
  });
});
