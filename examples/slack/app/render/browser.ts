/**
 * A single shared headless Chromium for local chart/diagram rendering.
 *
 * The rendering happens entirely in-process (our own browser) — only the
 * charting *library* is fetched from a CDN; the user's data never leaves the
 * host. Reuse one browser across renders so we don't pay a launch per call;
 * `closeBrowser()` is wired into the bridge's shutdown.
 *
 * Requires a Chromium binary: `npx playwright install chromium`.
 */
import { chromium, type Browser } from "playwright";

let browserPromise: Promise<Browser> | undefined;
let closing = false;

export function getBrowser(): Promise<Browser> {
  if (closing) {
    return Promise.reject(new Error("renderer is shutting down"));
  }
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ["--no-sandbox"] });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  // Claim shutdown and detach the promise BEFORE awaiting, so a concurrent
  // getBrowser() rejects cleanly instead of handing back a browser we're
  // about to close out from under it.
  closing = true;
  const pending = browserPromise;
  browserPromise = undefined;
  const b = await pending.catch(() => undefined);
  await b?.close().catch(() => {});
}
