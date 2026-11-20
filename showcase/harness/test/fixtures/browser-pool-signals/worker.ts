import assert from "node:assert/strict";
import { BrowserPool } from "../../../src/probes/helpers/browser-pool.js";

const signal = process.argv[2];
assert(signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGHUP");

function send(marker: string): Promise<void> {
  return new Promise((resolve, reject) => {
    assert(process.send, "fixture requires an IPC channel");
    process.send(marker, (error) => (error ? reject(error) : resolve()));
  });
}

const pool = new BrowserPool({
  browsers: 1,
  maxContexts: 1,
  heartbeatMs: 0,
  launchStaggerMs: 0,
});

async function fail(error: unknown): Promise<void> {
  try {
    await send(
      `error: ${error instanceof Error ? error.stack : String(error)}`,
    );
  } finally {
    await pool.shutdown();
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Production boots the pool before bootFleet installs its signal handlers.
  await pool.init();
  const context = await pool.acquire();
  const browser = context.browser();
  assert(browser);
  const page = await context.newPage();
  await page.goto("data:text/html,<title>active local work</title>");
  let contextClosed = false;
  context.on("close", () => {
    contextClosed = true;
  });
  // Parent releases work only after observing the signal handler's start marker.
  const finishWork = new Promise<void>((resolve) => {
    process.on("message", (message) => {
      if (message === "finish-work") resolve();
    });
  });
  const handleSignal = async (): Promise<void> => {
    await send(signal === "SIGHUP" ? "reload-start" : "drain-start");
    assert.equal(await page.evaluate(() => 6 * 7), 42);
    await finishWork;
    // Real browser activity must remain usable through the deferred work/report.
    assert.equal(await page.evaluate(() => 7 * 6), 42);
    assert(browser.isConnected());
    assert(!contextClosed);
    await send(signal === "SIGHUP" ? "reload-survived" : "work-reported");
    await send("pool-shutdown");
    await pool.shutdown();
    assert(contextClosed, "pool shutdown must close the active context");
    assert(page.isClosed(), "pool shutdown must close the active page");
    assert(!browser.isConnected(), "pool shutdown must close Chromium");
    await pool.shutdown(); // Repeated teardown remains safe.
    await send("closed");
    process.exit(0);
  };
  process.once(signal, () => {
    void handleSignal().catch(fail);
  });
  await send("ready");
}

void main().catch(fail);
