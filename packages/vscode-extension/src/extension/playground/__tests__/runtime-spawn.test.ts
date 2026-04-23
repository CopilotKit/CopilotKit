import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { spawnRuntime } from "../runtime-spawn";

const ENTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "dist",
  "runtime",
  "subprocess-entry.cjs",
);

describe("spawnRuntime", () => {
  it("spawns the subprocess, returns its URL, and can stop it", async () => {
    const handle = await spawnRuntime({
      entryScript: ENTRY_PATH,
      config: {
        port: 0,
        llmBaseUrl: "http://127.0.0.1:1",
        provider: "openai",
        model: "gpt-4o-mini",
        apiKey: "sk-test",
      },
    });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await handle.stop();
    }
  }, 20_000);

  it("rejects when the subprocess fails to start within the timeout", async () => {
    await expect(
      spawnRuntime({
        entryScript: "/definitely/not/a/real/script.js",
        config: {
          port: 0,
          llmBaseUrl: "http://127.0.0.1:1",
          provider: "openai",
          model: "gpt-4o-mini",
          apiKey: "sk-test",
        },
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });
});
