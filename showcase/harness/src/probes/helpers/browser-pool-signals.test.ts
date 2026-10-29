import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Browser } from "playwright";

describe("BrowserPool signal ownership", () => {
  it("leaves harness drain and reload signals to the harness on real launches", async () => {
    const launch = vi.fn(
      async () =>
        ({
          on: vi.fn(),
          isConnected: () => true,
          close: vi.fn(async () => {}),
        }) as unknown as Browser,
    );
    vi.doMock("playwright", () => ({ chromium: { launch } }));
    vi.resetModules();
    const { BrowserPool } = await import("./browser-pool.js");
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      heartbeatMs: 0,
      launchStaggerMs: 0,
    });
    try {
      await pool.init();
      expect(launch).toHaveBeenCalledExactlyOnceWith({
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
        handleSIGTERM: false,
        handleSIGINT: false,
        handleSIGHUP: false,
      });
    } finally {
      await pool.shutdown();
      vi.doUnmock("playwright");
      vi.resetModules();
    }
  });
});

// Each signal targets only a fresh child PID; Playwright and pool are unmocked
// in that child. No network, provider, live harness, or browser download is used.
describe("BrowserPool real Chromium signals", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    it(`keeps active work usable through ${signal} until pool shutdown`, async () => {
      const child = fork(
        fileURLToPath(
          new URL(
            "../../../test/fixtures/browser-pool-signals/worker.ts",
            import.meta.url,
          ),
        ),
        [signal],
        {
          execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")],
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      const markers: string[] = [];
      let diagnostics = "";
      child.stdout?.on("data", (data: Buffer) => {
        diagnostics = (diagnostics + data.toString()).slice(-16_000);
      });
      child.stderr?.on("data", (data: Buffer) => {
        diagnostics = (diagnostics + data.toString()).slice(-16_000);
      });
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once("close", (code, exitSignal) =>
          resolve({ code, signal: exitSignal }),
        );
      });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            deadline = setTimeout(
              () => reject(new Error("signal child deadline exceeded")),
              20_000,
            );
            child.once("error", reject);
            child.on("message", (message) => {
              if (typeof message !== "string") return;
              markers.push(message);
              if (message === "ready") {
                // Never signal the test runner, its parent, or a process group.
                if (!child.kill(signal))
                  reject(new Error("could not signal child"));
              }
              if (message === "drain-start" || message === "reload-start") {
                child.send("finish-work", (error) => {
                  if (error) reject(error);
                });
              }
            });
          }),
        ]);
        expect(result, `${markers.join(" -> ")}\n${diagnostics}`).toEqual({
          code: 0,
          signal: null,
        });
        expect(markers).toEqual([
          "ready",
          signal === "SIGHUP" ? "reload-start" : "drain-start",
          signal === "SIGHUP" ? "reload-survived" : "work-reported",
          "pool-shutdown",
          "closed",
        ]);
      } finally {
        if (deadline) clearTimeout(deadline);
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
        await exited;
      }
    }, 25_000);
  }
});
