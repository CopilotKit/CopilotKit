import { spawn } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// tsdown emits .cjs for CJS format builds.
const ENTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "dist",
  "runtime",
  "subprocess-entry.cjs",
);

describe("runtime subprocess", () => {
  it("prints ready JSON and serves /api/copilotkit", async () => {
    const config = JSON.stringify({
      port: 0,
      llmBaseUrl: "http://127.0.0.1:1",
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    });
    const child = spawn(process.execPath, [ENTRY_PATH], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        COPILOTKIT_PLAYGROUND_CONFIG: config,
      },
    });

    let port = 0;
    const ready = new Promise<void>((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const newline = buf.indexOf("\n");
        if (newline < 0) return;
        const first = buf.slice(0, newline).trim();
        try {
          const msg = JSON.parse(first);
          if (msg.ready === true && typeof msg.port === "number") {
            port = msg.port;
            resolve();
          }
        } catch {
          /* not the JSON line — keep buffering */
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        // Print stderr so build/import errors surface in test output
        process.stderr.write("[subprocess stderr] " + chunk.toString());
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code !== null && code !== 0) reject(new Error(`exited ${code}`));
      });
      setTimeout(() => reject(new Error("timeout waiting for ready")), 10_000);
    });

    try {
      await ready;
      expect(port).toBeGreaterThan(0);
      // Minimal liveness check: hitting the server should return *something*.
      const res = await fetch(`http://127.0.0.1:${port}/api/copilotkit`, {
        method: "OPTIONS",
      }).catch(() => null);
      expect(res).not.toBeNull();
    } finally {
      child.kill();
    }
  }, 20_000);
});
