import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("verify-prod-resweep CLI startup", () => {
  it("loads the shared cell model before checking required configuration", () => {
    // Vitest transforms imports and hides Node's ESM/CommonJS boundary at the
    // standalone dashboard's re-export barrels. Exercise the real tsx CLI,
    // with no credentials or closure so it cannot enqueue or call a provider.
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("./verify-prod-resweep.ts", import.meta.url)),
      ],
      {
        cwd: fileURLToPath(new URL(".", import.meta.url)),
        env: { PATH: process.env.PATH },
        encoding: "utf8",
        timeout: 15000,
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PROMOTED_CLOSURE_CSV is not set");
    expect(result.stderr).not.toContain("does not provide an export named");
  });
});
