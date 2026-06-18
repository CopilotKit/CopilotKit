import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";
import type { Browser } from "playwright";

import { attachSseInterceptor } from "../../src/probes/helpers/sse-interceptor.js";

/**
 * Phase 3 Task 3.1 mechanism-GREEN test for the
 * `__hk_runsFinished` page-side counter exposed by
 * `attachSseInterceptor`.
 *
 * This test launches a real chromium page, attaches the interceptor,
 * intercepts a fake SSE response via `page.route`, and asserts that
 * `window.__hk_runsFinished` increases monotonically as
 * `RUN_FINISHED` events are observed on the SSE stream.
 *
 * Why this lives under `test/integration/` (and not
 * `src/probes/helpers/sse-interceptor.test.ts`):
 *   - launches a real Chromium browser process (the existing
 *     `sse-interceptor.test.ts` is a pure-function unit test with no
 *     browser at all);
 *   - asserts an observable on `window` produced by Playwright
 *     `page.addInitScript` wiring — only meaningful in a real page
 *     context;
 *   - `vitest.integration.config.ts` uses `singleFork: true` so the
 *     browser launch cost is paid once for the suite.
 *
 * IMPORTANT — fresh BrowserContext per interceptor-attaching test:
 *   Every test in this file that calls `attachSseInterceptor` MUST
 *   create its own `browser.newContext()` + `context.newPage()`,
 *   wrapped in `try/finally` with `await context.close()`. The
 *   interceptor's page-level `__hk_sse_attached` cache and the
 *   page-side `__hk_fetchWrapped` guard are cumulative on a context:
 *   reusing a context across tests silently no-ops subsequent
 *   `attachSseInterceptor` calls (the FIRST-registered endpointPattern
 *   wins) and bleeds init-script wiring across tests. See r3f4
 *   (commit f5e1a810a) and r4f3 for the historical fixes that landed
 *   this discipline. Do NOT add a shared `context`/`page` back to
 *   `beforeAll` for interceptor-attaching tests.
 */

const ENDPOINT_PATH = "/api/copilotkit/agent/runtime";
const ENDPOINT_URL = `https://example.invalid${ENDPOINT_PATH}`;

// v2 single-route transport hits `runtimeUrl` verbatim — for
// `runtimeUrl="/api/copilotkit"` (the showcase default for
// langgraph-python + many others) the actual streaming-POST URL is
// `…/api/copilotkit` with NO trailing slash and NO `/agent/<id>/run`
// suffix (see ProxiedCopilotRuntimeAgent.constructor in
// packages/core/src/agent.ts and the v2 single-route handler at
// packages/runtime/src/v2/runtime/endpoints/hono-single.ts). Bug s12
// fixed a default-pattern mismatch where the regex required a trailing
// slash and so failed (a) entirely while the existing mechanism test
// (which uses an `/agent/…` URL) kept passing — this constant exists
// to lock that production URL shape into the test fixture.
const ROOT_ENDPOINT_PATH = "/api/copilotkit";
const ROOT_ENDPOINT_URL = `https://example.invalid${ROOT_ENDPOINT_PATH}`;

/** Build a minimal SSE payload with `runFinishedCount` RUN_FINISHED events. */
function buildSsePayload(runFinishedCount: number): string {
  const records: string[] = ['data: {"type":"RUN_STARTED","threadId":"t-1"}\n'];
  for (let i = 0; i < runFinishedCount; i++) {
    records.push(`data: {"type":"RUN_FINISHED","threadId":"t-1","seq":${i}}\n`);
  }
  return records.join("\n") + "\n";
}

describe("sse-interceptor __hk_runsFinished counter (mechanism-GREEN)", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("initializes window.__hk_runsFinished to 0 before any RUN_FINISHED arrives", async () => {
    // Fresh BrowserContext per interceptor-attaching test — see the
    // file-level comment above. Reusing a context across tests would
    // let `__hk_sse_attached` / `__hk_fetchWrapped` no-op subsequent
    // attaches and bleed init-script wiring into siblings.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await attachSseInterceptor(freshPage);
      await freshPage.goto("data:text/html,<html><body>idle</body></html>");
      const initial = await freshPage.evaluate(
        () =>
          (globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished,
      );
      // The counter is exposed at page boot (via addInitScript) and
      // starts at zero. If this read returns `undefined`, the init
      // script never ran — the page-side wiring is broken.
      expect(initial).toBe(0);
    } finally {
      await freshContext.close().catch(() => {});
    }
  }, 30_000);

  it("increments window.__hk_runsFinished on each RUN_FINISHED event on a matched SSE stream", async () => {
    // A fresh BrowserContext is required because `attachSseInterceptor`
    // installs a page-side fetch wrapper guarded by an idempotency cache
    // (`g.__hk_fetchWrapped` / `g.__hk_sse_attached`) — any subsequent
    // call on the same context NO-OPS and the FIRST-registered
    // endpointPattern wins. Since the previous test already attached the
    // interceptor with the DEFAULT pattern on the shared context, calling
    // `attachSseInterceptor(page, { endpointPattern: ENDPOINT_PATH })`
    // there would not actually re-bind to ENDPOINT_PATH. See
    // `attachSseInterceptor` in src/probes/helpers/sse-interceptor.ts.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      const handle = await attachSseInterceptor(freshPage, {
        endpointPattern: ENDPOINT_PATH,
      });
      // Serve a fake SSE stream from a page-loaded HTML fixture so
      // the interceptor sees a matching request fly from this page.
      await freshPage.route(ENDPOINT_URL, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: buildSsePayload(2),
        });
      });
      await freshPage.goto(
        "data:text/html,<html><body>fetch-driver</body></html>",
      );
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        // Drain the body to give the interceptor a chance to
        // observe every chunk via its tee/wrap of the streaming
        // response.
        await res.text();
      }, ENDPOINT_URL);
      // Allow microtask drain for the page-side counter increment to settle.
      await freshPage.waitForFunction(
        () =>
          ((globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished ?? 0) >= 2,
        null,
        { timeout: 10_000 },
      );
      const finalCount = await freshPage.evaluate(
        () =>
          (globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished,
      );
      expect(finalCount).toBe(2);
      await handle.stop().catch(() => {});
    } finally {
      await freshContext.close().catch(() => {});
    }
  }, 30_000);

  it("resets per-stream tracking state on mainFrame framenavigated so a post-reload SSE request is captured", async () => {
    // Cold-start retry repro: `runConversation` calls
    // `page.reload()` when turn 1 fails to stream. The CDP session
    // and surrounding closure persist, but the FIRST matching
    // request before the reload pinned `trackedRequestId`. Without
    // a framenavigated reset, the post-reload request is silently
    // ignored AND the final `Network.getResponseBody` call uses
    // the dead pre-reload request ID — Chromium has already evicted
    // that body buffer, so the capture comes back empty with no
    // operator-visible signal.
    //
    // This test drives the failure mode end-to-end on a fresh
    // BrowserContext so init-script state from the prior tests
    // doesn't bleed in:
    //   (a) attach interceptor (default pattern),
    //   (b) goto a fresh page, fire a first request matching the
    //       pattern (this would pin trackedRequestId pre-fix),
    //   (c) call `page.reload()` — mainFrame framenavigated must
    //       fire and reset the tracker,
    //   (d) fire a SECOND request, stop the interceptor, assert
    //       the capture reflects the post-reload stream's contents
    //       (one TOOL_CALL_START with the post-reload tool name).
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      const RELOAD_PATH = "/api/copilotkit";
      const RELOAD_URL = `https://example.invalid${RELOAD_PATH}`;
      let requestCount = 0;
      await freshPage.route(RELOAD_URL, async (route) => {
        requestCount++;
        const which = requestCount === 1 ? "pre" : "post";
        const records = [
          'data: {"type":"RUN_STARTED","threadId":"t-1"}\n',
          `data: {"type":"TOOL_CALL_START","toolCallId":"tc-${which}","toolCallName":"${which}_reload_tool"}\n`,
          'data: {"type":"RUN_FINISHED","threadId":"t-1"}\n',
        ];
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: records.join("\n") + "\n",
        });
      });
      const handle = await attachSseInterceptor(freshPage); // DEFAULT pattern
      await freshPage.goto(
        "data:text/html,<html><body>pre-reload</body></html>",
      );
      // First request — would pin trackedRequestId pre-fix.
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        await res.text();
      }, RELOAD_URL);
      // Wait for the first stream to complete so __hk_runsFinished
      // settles to 1 before the reload.
      await freshPage.waitForFunction(
        () =>
          ((globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished ?? 0) >= 1,
        null,
        { timeout: 10_000 },
      );
      // Reload — mainFrame framenavigated must fire and reset the
      // tracking vars. Re-register the same route on the (new)
      // page object isn't necessary because page.route is bound
      // to the Page, not the navigation; the route still serves.
      await freshPage.reload();
      // Second request after reload — without the fix, the
      // interceptor would ignore it (trackedRequestId still
      // points at the pre-reload request id).
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        await res.text();
      }, RELOAD_URL);
      const capture = await handle.stop();
      // The post-reload stream's tool-call name must appear in the
      // capture. Pre-fix, `getResponseBody` for the dead pre-reload
      // request id either errored (→ empty payload) or returned the
      // already-consumed first stream's body — neither path includes
      // `post_reload_tool`.
      expect(capture.toolCalls).toContain("post_reload_tool");
      expect(capture.toolCalls).not.toContain("pre_reload_tool");
      // raw_event_count > 0 confirms the post-reload body was
      // fetched successfully (not evicted).
      expect(capture.raw_event_count).toBeGreaterThan(0);
      // Sanity: the route was hit twice (first + post-reload).
      expect(requestCount).toBe(2);
    } finally {
      await freshContext.close().catch(() => {});
    }
  }, 30_000);

  it("invalidates the page handle cache after stop() so a second attach instruments a fresh stream (r6f1)", async () => {
    // r6f1 regression repro: the page-level `__hk_sse_attached` cache
    // (added by r1f2) returned the SAME handle to every
    // `attachSseInterceptor(page)` call on a given page lifecycle.
    // After the first caller's `stop()` ran, `stopPromise` cached the
    // resolved capture and the CDP session was detached. A SECOND
    // caller that re-attached on the same page would silently:
    //   (a) get the cached handle back from attachSseInterceptor,
    //   (b) receive the FIRST stream's capture from `stop()` (cached
    //       resolved promise), and
    //   (c) never instrument the second stream at all because the CDP
    //       session is already detached.
    //
    // Fix: `doStop` flips a `consumed` flag on the handle AND deletes
    // the page cache entry. The attach-side check treats a
    // cached-but-consumed handle as a cache miss and creates a fresh
    // handle. This test exercises that contract end-to-end.
    //
    // Fresh BrowserContext per the file-level discipline above.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      const CACHE_PATH = "/api/copilotkit";
      const CACHE_URL = `https://example.invalid${CACHE_PATH}`;
      let requestCount = 0;
      await freshPage.route(CACHE_URL, async (route) => {
        requestCount++;
        const which = requestCount === 1 ? "first" : "second";
        const records = [
          'data: {"type":"RUN_STARTED","threadId":"t-1"}\n',
          `data: {"type":"TOOL_CALL_START","toolCallId":"tc-${which}","toolCallName":"${which}_attach_tool"}\n`,
          'data: {"type":"RUN_FINISHED","threadId":"t-1"}\n',
        ];
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: records.join("\n") + "\n",
        });
      });

      // Attach #1 → request → stop(). Asserts the first capture sees
      // the first stream.
      const handle1 = await attachSseInterceptor(freshPage);
      await freshPage.goto(
        "data:text/html,<html><body>cache-invalidation</body></html>",
      );
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        await res.text();
      }, CACHE_URL);
      const capture1 = await handle1.stop();
      expect(capture1.toolCalls).toContain("first_attach_tool");
      expect(capture1.toolCalls).not.toContain("second_attach_tool");

      // Attach #2 on the SAME page after stop(). Pre-fix, the cache
      // would short-circuit and return the same `handle1` object —
      // and `handle2.stop()` would resolve to `capture1` from the
      // cached `stopPromise`. Post-fix, the cache was invalidated by
      // doStop (both via consumed-flag and via cache delete) so we
      // get a fresh handle with a fresh CDP session.
      const handle2 = await attachSseInterceptor(freshPage);
      expect(handle2).not.toBe(handle1);

      // Fire the SECOND request; the fresh interceptor must capture
      // it on the new CDP session.
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        await res.text();
      }, CACHE_URL);
      const capture2 = await handle2.stop();
      // The contract: the second capture reflects the SECOND request,
      // not the cached first capture.
      expect(capture2.toolCalls).toContain("second_attach_tool");
      expect(capture2.toolCalls).not.toContain("first_attach_tool");
      expect(capture2.raw_event_count).toBeGreaterThan(0);

      // Sanity: the route was hit twice (one per attach cycle).
      expect(requestCount).toBe(2);
    } finally {
      await freshContext.close().catch(() => {});
    }
  }, 30_000);

  it("increments __hk_runsFinished against the production single-route URL shape (no trailing slash, no /agent/<id>/run suffix)", async () => {
    // Production-shape integration assertion. The v2 single-route
    // transport hits `runtimeUrl` exactly — so for the default
    // showcase wiring (`runtimeUrl="/api/copilotkit"`, single
    // transport) the streaming POST goes to `…/api/copilotkit` with
    // NO trailing slash. The previous default endpoint pattern
    // (`/\/api\/copilotkit\//`, with trailing slash) failed to match
    // that URL — the wrapper installed by `attachSseInterceptor`
    // saw the fetch, decided it was off-target, and let the body
    // flow through unparsed. `__hk_runsFinished` stayed at 0 even
    // though the assistant streamed text successfully, and
    // `waitForTurnComplete` timed out every defect-1/defect-4 turn
    // with reason=sse-missing. This test exercises THAT URL shape
    // with the DEFAULT pattern (no per-test override) so any future
    // regression of the pattern fails here before it reaches the
    // bubble-race suite.
    //
    // A fresh BrowserContext is used because `page.addInitScript`
    // is CUMULATIVE on a context: the prior tests' attachSseInterceptor
    // calls registered init scripts with overridden patterns that still
    // run on every navigation, and the in-page wrapper has an
    // idempotency guard (`g.__hk_fetchWrapped === true`) that no-ops
    // every subsequent registration. Without a fresh context the
    // FIRST-registered pattern (a path-string override from the
    // mechanism test) would win and the default-pattern assertion
    // we're trying to make here would be silently invalidated.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      const handle = await attachSseInterceptor(freshPage); // uses DEFAULT pattern
      await freshPage.route(ROOT_ENDPOINT_URL, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: buildSsePayload(1),
        });
      });
      await freshPage.goto(
        "data:text/html,<html><body>fetch-driver-root</body></html>",
      );
      await freshPage.evaluate(async (url) => {
        const res = await fetch(url);
        await res.text();
      }, ROOT_ENDPOINT_URL);
      await freshPage.waitForFunction(
        () =>
          ((globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished ?? 0) >= 1,
        null,
        { timeout: 10_000 },
      );
      const finalCount = await freshPage.evaluate(
        () =>
          (globalThis as unknown as { __hk_runsFinished?: number })
            .__hk_runsFinished,
      );
      expect(finalCount).toBe(1);
      await handle.stop().catch(() => {});
    } finally {
      await freshContext.close().catch(() => {});
    }
  }, 30_000);
});
